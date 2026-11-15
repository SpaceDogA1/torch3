import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { ProjectId } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as OrchestryCli from "./OrchestryCli.ts";
import * as OrchestryRuntime from "./OrchestryRuntime.ts";
import * as OrchestryWorkspace from "./OrchestryWorkspace.ts";

/**
 * Runs the real `@oxgeneral/orch` CLI against disposable Git repositories. Agents use
 * ORCH's `shell` adapter with a fixed Node script, so no model or credential is involved.
 */

const servicesLayer = OrchestryRuntime.layer.pipe(
  Layer.provideMerge(OrchestryWorkspace.layer),
  Layer.provideMerge(OrchestryCli.layer),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-orchestry-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const git = Effect.fn("test.git")(function* (cwd: string, args: ReadonlyArray<string>) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const output = yield* runner.run({ command: "git", args, cwd });
  if (output.code !== 0) throw new Error(`git ${args.join(" ")}: ${output.stderr}`);
  return output.stdout.trim();
});

const makeRepository = Effect.fn("test.makeRepository")(function* (withCommit: boolean) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-orchestry-repo-" }),
  );
  yield* git(root, ["init", "-q", "-b", "main"]);
  yield* git(root, ["config", "user.name", "T3 Test"]);
  yield* git(root, ["config", "user.email", "t3-test@example.invalid"]);
  if (withCommit) {
    yield* fileSystem.writeFileString(path.join(root, "a.txt"), "hello\n");
    yield* git(root, ["add", "-A"]);
    yield* git(root, ["commit", "-q", "-m", "init"]);
  }
  return root;
});

/** A shell-adapter agent that commits one file in its task worktree, as real agents must. */
const writeAgentScript = Effect.fn("test.writeAgentScript")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-orchestry-agent-" });
  const script = path.join(directory, "agent.cjs");
  yield* fileSystem.writeFileString(
    script,
    [
      'const { execFileSync } = require("node:child_process");',
      'require("node:fs").writeFileSync("agent-out.txt", "from agent\\n");',
      'execFileSync("git", ["add", "agent-out.txt"]);',
      'execFileSync("git", ["-c", "user.name=agent", "-c", "user.email=agent@example.invalid", "commit", "-q", "-m", "agent work"]);',
    ].join("\n"),
  );
  return script;
});

describe("ORCH integration", () => {
  it.live("runs a task in its own worktree and merges only into the integration branch", () =>
    Effect.gen(function* () {
      const workspace = yield* OrchestryWorkspace.OrchestryWorkspace;
      const runtime = yield* OrchestryRuntime.OrchestryRuntime;
      const cli = yield* OrchestryCli.OrchestryCli;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectId = ProjectId.make("integration-run");

      const repository = yield* makeRepository(true);
      const userHead = yield* git(repository, ["rev-parse", "HEAD"]);
      const paths = yield* workspace.prepare({
        projectId,
        workspaceRoot: repository,
        projectName: "integration",
        adapter: "shell",
      });
      assert.strictEqual(paths.branch, "t3-orchestry/integration-run");

      const script = yield* writeAgentScript();
      const agent = (yield* cli.runJson({
        operation: "agent add",
        cwd: paths.integrationRoot,
        args: ["agent", "add", "committer", "--adapter", "shell", "--command", `node "${script}"`],
      })) as { readonly id: string };
      yield* cli.runJson({
        operation: "task add",
        cwd: paths.integrationRoot,
        args: [
          "task",
          "add",
          "commit a file",
          "--assignee",
          agent.id,
          "--workspace-mode",
          "worktree",
        ],
      });

      const started = yield* runtime.start(projectId);
      assert.strictEqual(started.state, "running");
      const again = yield* runtime.start(projectId);
      assert.strictEqual(again.pid, started.pid, "a second start must not spawn another ORCH");

      const events = yield* runtime.events(projectId).pipe(
        Stream.takeUntil(
          (event) => event.event === "task:status_changed" && event.fields.to === "done",
        ),
        Stream.runCollect,
      );
      const names = events.map((event) => event.event);
      expect(names).toContain("serve:started");
      expect(names).toContain("agent:started");
      expect(names).toContain("workspace:merge_succeeded");
      expect(events.find((event) => event.event === "agent:completed")?.fields.success).toBe(true);
      const sequences = events.map((event) => event.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));

      // The user's checkout is untouched; the agent's commit landed on the integration branch.
      assert.strictEqual(yield* git(repository, ["rev-parse", "HEAD"]), userHead);
      assert.strictEqual(yield* git(repository, ["status", "--porcelain"]), "");
      assert.isFalse(yield* fileSystem.exists(path.join(repository, "agent-out.txt")));
      assert.isTrue(yield* fileSystem.exists(path.join(paths.integrationRoot, "agent-out.txt")));
      expect(yield* git(repository, ["log", "--format=%s", paths.branch])).toContain("agent work");

      const stopped = yield* runtime.stop(projectId);
      assert.strictEqual(stopped.state, "stopped");
      assert.isNull(stopped.lastError);
      assert.isFalse(yield* fileSystem.exists(paths.lockPath), "ORCH releases its lock");
      const shutdown = yield* runtime.events(projectId, events.at(-1)?.sequence).pipe(
        Stream.takeUntil((event) => event.event === "orchestrator:shutdown"),
        Stream.runCollect,
      );
      expect(shutdown.at(-1)?.event).toBe("orchestrator:shutdown");
    }).pipe(Effect.provide(servicesLayer), Effect.scoped),
  );

  it.live("reports a live lock it did not create as external and refuses to start", () =>
    Effect.gen(function* () {
      const workspace = yield* OrchestryWorkspace.OrchestryWorkspace;
      const runtime = yield* OrchestryRuntime.OrchestryRuntime;
      const fileSystem = yield* FileSystem.FileSystem;
      const projectId = ProjectId.make("integration-external");
      const repository = yield* makeRepository(true);
      const paths = yield* workspace.prepare({
        projectId,
        workspaceRoot: repository,
        projectName: "external",
        adapter: "shell",
      });

      // This test process stands in for an ORCH started from a terminal.
      yield* fileSystem.writeFileString(paths.lockPath, String(process.pid));
      const status = yield* runtime.status(projectId);
      assert.strictEqual(status.state, "external");
      assert.strictEqual(status.pid, process.pid);
      const error = yield* runtime.start(projectId).pipe(Effect.flip);
      assert.strictEqual(
        error._tag === "OrchestryRuntimeError" ? error.reason : error._tag,
        "already-running-external",
      );
      yield* fileSystem.remove(paths.lockPath);
      assert.strictEqual((yield* runtime.status(projectId)).state, "stopped");
    }).pipe(Effect.provide(servicesLayer), Effect.scoped),
  );

  it.live("refuses projects ORCH's init would otherwise turn into commits", () =>
    Effect.gen(function* () {
      const workspace = yield* OrchestryWorkspace.OrchestryWorkspace;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const plain = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-orchestry-plain-" });
      const notRepository = yield* workspace
        .prepare({
          projectId: ProjectId.make("plain"),
          workspaceRoot: plain,
          projectName: "plain",
          adapter: "shell",
        })
        .pipe(Effect.flip);
      // Which one depends on whether the temp directory sits inside some other repository.
      expect(["not-a-git-repository", "not-repository-root"]).toContain(
        notRepository._tag === "OrchestryWorkspaceError"
          ? notRepository.reason
          : notRepository._tag,
      );
      assert.isFalse(yield* fileSystem.exists(path.join(plain, ".git")));

      const empty = yield* makeRepository(false);
      const noCommits = yield* workspace
        .prepare({
          projectId: ProjectId.make("empty"),
          workspaceRoot: empty,
          projectName: "empty",
          adapter: "shell",
        })
        .pipe(Effect.flip);
      assert.strictEqual(
        noCommits._tag === "OrchestryWorkspaceError" ? noCommits.reason : noCommits._tag,
        "no-commits",
      );
      assert.strictEqual(yield* git(empty, ["rev-list", "--all", "--count"]), "0");
    }).pipe(Effect.provide(servicesLayer), Effect.scoped),
  );
});
