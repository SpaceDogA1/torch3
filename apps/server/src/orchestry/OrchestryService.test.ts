import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { ProjectId, type Project } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as OrchestryCli from "./OrchestryCli.ts";
import * as OrchestryService from "./OrchestryService.ts";
import * as OrchestryWorkspace from "./OrchestryWorkspace.ts";

describe("ORCH record mapping", () => {
  it("maps `orch status --json` task and agent records", () => {
    // Shapes as ORCH 1.0.34 printed them in a real run.
    expect(
      OrchestryService.toOrchestryTask({
        id: "tsk_6DXCX-0",
        title: "commit file",
        description: "",
        status: "done",
        priority: 3,
        assignee: "agt_S_qU2Ue",
        labels: [],
        depends_on: [],
        created_at: "2026-11-15T15:01:13.000Z",
        updated_at: "2026-11-15T15:01:15.451Z",
        attempts: 1,
        max_attempts: 3,
        proof: { branch: "orchestry/tsk_6DXCX-0/commit-file", files_changed: ["agent-out.txt"] },
      }),
    ).toMatchObject({
      id: "tsk_6DXCX-0",
      status: "done",
      assigneeId: "agt_S_qU2Ue",
      goalId: null,
      branch: "orchestry/tsk_6DXCX-0/commit-file",
      filesChanged: ["agent-out.txt"],
    });
    expect(
      OrchestryService.toOrchestryAgent({
        id: "agt_creator",
        name: "Agent Creator",
        adapter: "claude",
        config: { model: "claude-sonnet", approval_policy: "suggest" },
        status: "idle",
        stats: { tasks_completed: 2, tasks_failed: 1, total_runs: 3, total_runtime_ms: 10 },
        last_error: { message: "rate limited", kind: "rate_limit", timestamp: "t" },
      }),
    ).toMatchObject({
      model: "claude-sonnet",
      tasksCompleted: 2,
      tasksFailed: 1,
      lastError: "rate limited",
    });
  });

  it("tolerates records missing optional or unexpected fields", () => {
    const task = OrchestryService.toOrchestryTask({ id: "tsk_x", status: 7, depends_on: "nope" });
    expect(task).toMatchObject({ id: "tsk_x", status: "unknown", dependsOn: [], branch: null });
  });

  it("parses numstat lines, keeping binary files without counts", () => {
    expect(OrchestryService.parseNumstat("3\t1\tsrc/a.ts\n-\t-\tlogo.png\n\n")).toEqual([
      { path: "src/a.ts", additions: 3, deletions: 1 },
      { path: "logo.png", additions: null, deletions: null },
    ]);
  });
});

const git = Effect.fn("test.git")(function* (cwd: string, args: ReadonlyArray<string>) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const output = yield* runner.run({ command: "git", args, cwd });
  if (output.code !== 0) throw new Error(`git ${args.join(" ")}: ${output.stderr}`);
  return output.stdout.trim();
});

const projectId = ProjectId.make("service-project");

/** A real ORCH stack whose project lookup resolves `projectId` to a disposable repository. */
const makeLayer = (workspaceRoot: string) =>
  OrchestryService.layerWithDependencies.pipe(
    Layer.provideMerge(
      Layer.mock(ProjectService.ProjectService)({
        getById: (id) =>
          Effect.succeed(
            id === projectId
              ? Option.some({
                  id: projectId,
                  title: "service",
                  workspaceRoot,
                  defaultModelSelection: null,
                  scripts: [],
                } as unknown as Project)
              : Option.none(),
          ),
      }),
    ),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-orchestry-service-" })),
    Layer.provideMerge(NodeServices.layer),
  );

const makeRepository = Effect.fn("test.makeRepository")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.realPath(
    yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-orchestry-service-repo-" }),
  );
  yield* git(root, ["init", "-q", "-b", "main"]);
  yield* git(root, ["config", "user.name", "T3 Test"]);
  yield* git(root, ["config", "user.email", "t3-test@example.invalid"]);
  yield* fileSystem.writeFileString(path.join(root, "a.txt"), "hello\n");
  yield* git(root, ["add", "-A"]);
  yield* git(root, ["commit", "-q", "-m", "init"]);
  return root;
});

describe("OrchestryService", () => {
  it.live("runs the user-facing flow: enable, work, review the branch, merge, disable", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repository = yield* makeRepository();
      yield* Effect.gen(function* () {
        const service = yield* OrchestryService.OrchestryService;
        const cli = yield* OrchestryCli.OrchestryCli;
        const workspace = yield* OrchestryWorkspace.OrchestryWorkspace;

        const before = yield* service.overview(projectId);
        assert.isFalse(before.enabled);
        assert.isNull(before.blockedReason, "an eligible repository can be enabled");
        const notEnabled = yield* service.start(projectId).pipe(Effect.flip);
        assert.strictEqual(notEnabled.reason, "not-enabled");

        const enabled = yield* service.enable(projectId, "claude");
        assert.isTrue(enabled.enabled);
        // ORCH's default agent uses a real provider; remove it so nothing here can spend credits.
        for (const agent of enabled.agents) yield* service.removeAgent(projectId, agent.id);

        const root = workspace.paths(projectId).integrationRoot;
        const script = path.join(root, "..", "agent.cjs");
        yield* fileSystem.writeFileString(
          script,
          [
            'const { execFileSync } = require("node:child_process");',
            'require("node:fs").writeFileSync("feature.txt", "from agent\\n");',
            'execFileSync("git", ["add", "feature.txt"]);',
            'execFileSync("git", ["-c", "user.name=agent", "-c", "user.email=agent@example.invalid", "commit", "-q", "-m", "agent feature"]);',
          ].join("\n"),
        );
        // Shell agents run host commands, so the service API cannot create them; the CLI can.
        const agent = (yield* cli.runJson({
          operation: "agent add",
          cwd: root,
          args: ["agent", "add", "builder", "--adapter", "shell", "--command", `node "${script}"`],
        })) as { readonly id: string };

        const goal = yield* service.createGoal(projectId, { title: "Ship a feature" });
        const task = yield* service.createTask(projectId, {
          title: "Write the feature",
          description: "- a Markdown bullet that starts with a dash",
          assigneeId: agent.id,
          goalId: goal.id,
        });
        assert.strictEqual(task.status, "todo");
        assert.strictEqual(task.goalId, goal.id);

        yield* service.start(projectId);
        const syncWhileRunning = yield* service.syncIntegration(projectId).pipe(Effect.flip);
        assert.strictEqual(syncWhileRunning.reason, "runtime-active");
        yield* service.events(projectId).pipe(
          Stream.takeUntil(
            (event) => event.event === "task:status_changed" && event.fields.to === "done",
          ),
          Stream.runDrain,
        );
        yield* service.stop(projectId);

        const reviewed = yield* service.overview(projectId);
        expect(reviewed.integration).toMatchObject({ userBranch: "main", behind: 0 });
        expect(reviewed.integration?.ahead).toBeGreaterThan(0);
        expect(reviewed.integration?.files.map((file) => file.path)).toContain("feature.txt");
        expect((yield* service.integrationDiff(projectId)).patch).toContain("+from agent");
        const runs = yield* service.listRuns(projectId, task.id);
        expect(runs[0]).toMatchObject({ taskId: task.id, agentId: agent.id, status: "succeeded" });

        // Nothing reaches the user's checkout until an explicit merge, which refuses local edits.
        assert.isFalse(yield* fileSystem.exists(path.join(repository, "feature.txt")));
        yield* fileSystem.writeFileString(path.join(repository, "a.txt"), "local edit\n");
        const dirty = yield* service.mergeIntegration(projectId).pipe(Effect.flip);
        assert.strictEqual(dirty.reason, "user-checkout-dirty");
        yield* git(repository, ["checkout", "--", "a.txt"]);

        const merged = yield* service.mergeIntegration(projectId);
        assert.strictEqual(merged.integration?.ahead, 0);
        assert.isTrue(yield* fileSystem.exists(path.join(repository, "feature.txt")));

        const disabled = yield* service.disable(projectId);
        assert.isFalse(disabled.enabled);
        assert.isFalse(yield* fileSystem.exists(root));
        expect(
          yield* git(repository, ["branch", "--list", "t3-orchestry/service-project"]),
        ).toContain("t3-orchestry/service-project");
      }).pipe(Effect.provide(makeLayer(repository)));
    }).pipe(
      Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.scoped,
    ),
  );
});
