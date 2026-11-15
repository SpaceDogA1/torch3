import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse as parseYaml } from "yaml";

import type { OrchestryAdapter, ProjectId } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as OrchestryCli from "./OrchestryCli.ts";

/**
 * ORCH merges each finished task into its project root's branch before any review, so it
 * runs in an integration worktree (`t3-orchestry/<id>` under `<T3 home>/orchestry/`),
 * never the user's checkout. See docs/internals/orchestry.md.
 */

const ORCHESTRY_STATE_DIR = ".orchestry";
const INTEGRATION_BRANCH_PREFIX = "t3-orchestry/";
const ACTIVE_TASK_STATUSES = new Set(["todo", "in_progress", "retrying", "review"]);
const GIT_TIMEOUT = "60 seconds";

export class OrchestryWorkspaceError extends Schema.TaggedError<OrchestryWorkspaceError>()(
  "OrchestryWorkspaceError",
  {
    reason: Schema.Literals([
      "not-a-git-repository",
      "not-repository-root",
      "no-commits",
      "foreign-worktree",
      "git-failed",
      "state-unreadable",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/** ORCH state that would let an agent work outside its own task worktree. */
export class OrchestryIsolationError extends Schema.TaggedError<OrchestryIsolationError>()(
  "OrchestryIsolationError",
  { violations: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `ORCH must use workspace_mode "worktree": ${this.violations.join("; ")}`;
  }
}

export interface OrchestryWorkspacePaths {
  readonly integrationRoot: string;
  readonly branch: string;
  readonly stateDir: string;
  readonly lockPath: string;
}

export interface OrchestryPrepareInput {
  readonly projectId: ProjectId;
  /** The T3 project's own checkout. Read for its repository; never written. */
  readonly workspaceRoot: string;
  readonly projectName: string;
  readonly adapter: OrchestryAdapter;
}

export class OrchestryWorkspace extends Context.Service<
  OrchestryWorkspace,
  {
    readonly paths: (projectId: ProjectId) => OrchestryWorkspacePaths;
    /**
     * Creates (or reuses) the project's integration worktree and initializes ORCH in it.
     * Refuses a directory that is not a Git repository with at least one commit, so ORCH's
     * own `init` never runs `git init` or commits the user's files.
     */
    readonly prepare: (
      input: OrchestryPrepareInput,
    ) => Effect.Effect<
      OrchestryWorkspacePaths,
      | OrchestryWorkspaceError
      | OrchestryIsolationError
      | OrchestryCli.OrchestryCliError
      | OrchestryCli.OrchestryUnsupportedHostError
      | OrchestryCli.OrchestryArgumentError
    >;
    /** Fails when ORCH's config, an agent, or an unfinished task asks for a non-worktree mode. */
    readonly validateIsolation: (
      integrationRoot: string,
    ) => Effect.Effect<void, OrchestryIsolationError | OrchestryWorkspaceError>;
  }
>()("t3/orchestry/OrchestryWorkspace") {}

/** Branch-name and directory-safe form of a project id. */
export const orchestryProjectSlug = (projectId: string): string =>
  projectId.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "") || "project";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const workspaceModeOf = (value: unknown): unknown =>
  isRecord(value) ? value.workspace_mode : undefined;

/** Pure check over parsed ORCH documents; `undefined` modes fall back to ORCH's `worktree`. */
export function findIsolationViolations(input: {
  readonly config: unknown;
  readonly agents: ReadonlyArray<{ readonly file: string; readonly document: unknown }>;
  readonly tasks: ReadonlyArray<{ readonly file: string; readonly document: unknown }>;
}): ReadonlyArray<string> {
  const violations: Array<string> = [];
  const check = (where: string, mode: unknown) => {
    if (mode !== undefined && mode !== "worktree") violations.push(`${where} is "${String(mode)}"`);
  };
  const defaults = isRecord(input.config) ? input.config.defaults : undefined;
  check(
    "config.yml defaults.agent.workspace_mode",
    workspaceModeOf(isRecord(defaults) ? defaults.agent : undefined),
  );
  for (const agent of input.agents) {
    const config = isRecord(agent.document) ? agent.document.config : undefined;
    check(`agent ${agent.file} workspace_mode`, workspaceModeOf(config));
  }
  for (const task of input.tasks) {
    const status = isRecord(task.document) ? task.document.status : undefined;
    if (typeof status === "string" && !ACTIVE_TASK_STATUSES.has(status)) continue;
    check(`task ${task.file} workspace_mode`, workspaceModeOf(task.document));
  }
  return violations;
}

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const cli = yield* OrchestryCli.OrchestryCli;
  const platform = yield* HostProcess.Platform;

  const paths: OrchestryWorkspace["Service"]["paths"] = (projectId) => {
    const slug = orchestryProjectSlug(projectId);
    const integrationRoot = path.join(serverConfig.baseDir, "orchestry", slug, "workspace");
    const stateDir = path.join(integrationRoot, ORCHESTRY_STATE_DIR);
    return {
      integrationRoot,
      branch: `${INTEGRATION_BRANCH_PREFIX}${slug}`,
      stateDir,
      lockPath: path.join(stateDir, "orchestry.lock"),
    };
  };

  const git = Effect.fn("OrchestryWorkspace.git")(function* (
    cwd: string,
    args: ReadonlyArray<string>,
    reason: OrchestryWorkspaceError["reason"] = "git-failed",
  ) {
    const output = yield* processRunner
      .run({ command: "git", args, cwd, timeout: GIT_TIMEOUT })
      .pipe(
        Effect.mapError(
          (cause) =>
            new OrchestryWorkspaceError({
              reason: "git-failed",
              detail: `git ${args[0]} could not run in ${cwd}.`,
              cause,
            }),
        ),
      );
    if (output.code !== 0) {
      return yield* new OrchestryWorkspaceError({
        reason,
        detail: `git ${args.join(" ")} failed in ${cwd}: ${OrchestryCli.sanitizeOrchestryOutput(output.stderr)}`,
      });
    }
    return output.stdout.trim();
  });

  const samePath = (left: string, right: string) => {
    const normalize = (value: string) => {
      const resolved = path.resolve(value);
      return platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    return normalize(left) === normalize(right);
  };

  const commonDir = (cwd: string, reason: OrchestryWorkspaceError["reason"]) =>
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"], reason);

  const readYamlFiles = Effect.fn("OrchestryWorkspace.readYamlFiles")(function* (
    directory: string,
  ) {
    const exists = yield* fileSystem.exists(directory).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return [];
    const entries = yield* fileSystem.readDirectory(directory);
    const documents: Array<{ file: string; document: unknown }> = [];
    for (const file of entries.filter((entry) => entry.endsWith(".yml")).toSorted()) {
      const text = yield* fileSystem.readFileString(path.join(directory, file));
      documents.push({ file, document: parseYaml(text) as unknown });
    }
    return documents;
  });

  const validateIsolation: OrchestryWorkspace["Service"]["validateIsolation"] = Effect.fn(
    "OrchestryWorkspace.validateIsolation",
  )(function* (integrationRoot) {
    const stateDir = path.join(integrationRoot, ORCHESTRY_STATE_DIR);
    const loaded = yield* Effect.gen(function* () {
      const config = parseYaml(
        yield* fileSystem.readFileString(path.join(stateDir, "config.yml")),
      ) as unknown;
      const agents = yield* readYamlFiles(path.join(stateDir, "agents"));
      const tasks = yield* readYamlFiles(path.join(stateDir, "tasks"));
      return { config, agents, tasks };
    }).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestryWorkspaceError({
            reason: "state-unreadable",
            detail: `ORCH state in ${stateDir} could not be read.`,
            cause,
          }),
      ),
    );
    const violations = findIsolationViolations(loaded);
    if (violations.length > 0) return yield* new OrchestryIsolationError({ violations });
  });

  const ensureIntegrationWorktree = Effect.fn("OrchestryWorkspace.ensureIntegrationWorktree")(
    function* (workspaceRoot: string, target: OrchestryWorkspacePaths) {
      // A folder inside some other repository (even a home directory under Git) is not
      // the project: ORCH would operate on, and commit to, that enclosing repository.
      const topLevel = yield* git(
        workspaceRoot,
        ["rev-parse", "--show-toplevel"],
        "not-a-git-repository",
      );
      const [realTopLevel, realRoot] = yield* Effect.all([
        fileSystem.realPath(topLevel),
        fileSystem.realPath(workspaceRoot),
      ]).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestryWorkspaceError({
              reason: "not-a-git-repository",
              detail: `${workspaceRoot} could not be resolved.`,
              cause,
            }),
        ),
      );
      if (!samePath(realTopLevel, realRoot)) {
        return yield* new OrchestryWorkspaceError({
          reason: "not-repository-root",
          detail: `${workspaceRoot} is inside the Git repository at ${topLevel}, not its root. ORCH needs the project to be a repository of its own.`,
        });
      }
      const projectCommonDir = yield* commonDir(workspaceRoot, "not-a-git-repository");
      yield* git(
        workspaceRoot,
        ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        "no-commits",
      );

      const exists = yield* fileSystem
        .exists(target.integrationRoot)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        const existingCommonDir = yield* commonDir(target.integrationRoot, "foreign-worktree");
        if (!samePath(existingCommonDir, projectCommonDir)) {
          return yield* new OrchestryWorkspaceError({
            reason: "foreign-worktree",
            detail: `${target.integrationRoot} belongs to a different repository.`,
          });
        }
        return;
      }

      yield* fileSystem
        .makeDirectory(path.dirname(target.integrationRoot), { recursive: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestryWorkspaceError({
                reason: "git-failed",
                detail: `Cannot create ${path.dirname(target.integrationRoot)}.`,
                cause,
              }),
          ),
        );
      const branchExists = yield* git(workspaceRoot, ["branch", "--list", target.branch]).pipe(
        Effect.map((listed) => listed.length > 0),
      );
      yield* git(
        workspaceRoot,
        branchExists
          ? ["worktree", "add", target.integrationRoot, target.branch]
          : ["worktree", "add", "-b", target.branch, target.integrationRoot, "HEAD"],
      );
    },
  );

  const prepare: OrchestryWorkspace["Service"]["prepare"] = Effect.fn("OrchestryWorkspace.prepare")(
    function* (input) {
      const target = paths(input.projectId);
      const projectName = yield* OrchestryCli.orchestryArgument("project name", input.projectName);
      yield* ensureIntegrationWorktree(input.workspaceRoot, target);

      const initialized = yield* fileSystem
        .exists(target.stateDir)
        .pipe(Effect.orElseSucceed(() => false));
      if (!initialized) {
        yield* cli.runText({
          operation: "init",
          cwd: target.integrationRoot,
          args: ["init", "--adapter", input.adapter, "--name", projectName],
        });
        // ORCH's init appends `.orchestry` to the root .gitignore. Commit that on the
        // integration branch so ORCH's merges never meet a dirty tree.
        const gitignoreChange = yield* git(target.integrationRoot, [
          "status",
          "--porcelain",
          "--",
          ".gitignore",
        ]);
        if (gitignoreChange.length > 0) {
          yield* git(target.integrationRoot, ["add", "--", ".gitignore"]);
          yield* git(target.integrationRoot, [
            "commit",
            "-m",
            "orchestry: ignore ORCH state",
            "--",
            ".gitignore",
          ]);
        }
      }
      yield* validateIsolation(target.integrationRoot);
      return target;
    },
  );

  return OrchestryWorkspace.of({ paths, prepare, validateIsolation });
});

export const layer = Layer.effect(OrchestryWorkspace, make);
