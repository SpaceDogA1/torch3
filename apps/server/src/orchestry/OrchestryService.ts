import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  OrchestryError,
  type OrchestryAgent,
  type OrchestryAgentAdapter,
  type OrchestryEvent,
  type OrchestryGoal,
  type OrchestryGoalStatus,
  type OrchestryIntegration,
  type OrchestryOverview,
  type OrchestryRun,
  type OrchestryRuntimeStatus,
  type OrchestryTask,
  type OrchestryTeam,
  type ProjectId,
} from "@t3tools/contracts";

import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as OrchestryCli from "./OrchestryCli.ts";
import * as OrchestryRuntime from "./OrchestryRuntime.ts";
import * as OrchestryWorkspace from "./OrchestryWorkspace.ts";

const MAX_DIFF_CHARS = 400_000;
const MAX_INTEGRATION_FILES = 500;
const RUN_HISTORY_WINDOW = "30d";

type Failure = Effect.Effect<never, OrchestryError>;

const fail = (reason: string, message: string): Failure =>
  Effect.fail(new OrchestryError({ reason, message }));

/** Every lower-level failure becomes one wire error with a stable `reason`. */
const toOrchestryError = (error: {
  readonly _tag: string;
  readonly message: string;
  readonly reason?: unknown;
}): OrchestryError => {
  switch (error._tag) {
    case "OrchestryError":
      return error as OrchestryError;
    case "OrchestryWorkspaceError":
    case "OrchestryRuntimeError":
      return new OrchestryError({ reason: String(error.reason), message: error.message });
    case "OrchestryIsolationError":
      return new OrchestryError({ reason: "isolation-violated", message: error.message });
    case "OrchestryUnsupportedHostError":
      return new OrchestryError({ reason: "unsupported-host", message: error.message });
    case "OrchestryArgumentError":
      return new OrchestryError({ reason: "invalid-argument", message: error.message });
    case "OrchestryCliError":
      return new OrchestryError({ reason: "orch-command-failed", message: error.message });
    default:
      return new OrchestryError({ reason: "internal", message: error.message });
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const int = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const records = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter(isRecord) : [];

export const toOrchestryAgent = (raw: Record<string, unknown>): OrchestryAgent => {
  const config = isRecord(raw.config) ? raw.config : {};
  const stats = isRecord(raw.stats) ? raw.stats : {};
  const lastError = isRecord(raw.last_error) ? raw.last_error : undefined;
  return {
    id: str(raw.id),
    name: str(raw.name),
    adapter: str(raw.adapter),
    role: strOrNull(raw.role),
    model: strOrNull(config.model),
    status: str(raw.status, "unknown"),
    currentTaskId: strOrNull(raw.current_task),
    tasksCompleted: int(stats.tasks_completed),
    tasksFailed: int(stats.tasks_failed),
    lastError: lastError === undefined ? null : strOrNull(lastError.message),
  };
};

export const toOrchestryTask = (raw: Record<string, unknown>): OrchestryTask => {
  const proof = isRecord(raw.proof) ? raw.proof : {};
  return {
    id: str(raw.id),
    title: str(raw.title),
    description: str(raw.description),
    status: str(raw.status, "unknown"),
    priority: int(raw.priority, 3),
    assigneeId: strOrNull(raw.assignee),
    goalId: strOrNull(raw.goalId),
    dependsOn: strings(raw.depends_on),
    attempts: int(raw.attempts),
    maxAttempts: int(raw.max_attempts),
    branch: strOrNull(proof.branch),
    filesChanged: strings(proof.files_changed),
    agentSummary: strOrNull(proof.agent_summary),
    feedback: strOrNull(raw.feedback),
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
  };
};

const toOrchestryGoal = (raw: Record<string, unknown>): OrchestryGoal => ({
  id: str(raw.id),
  title: str(raw.title),
  description: str(raw.description),
  status: str(raw.status, "unknown"),
  assigneeId: strOrNull(raw.assignee),
  createdAt: str(raw.created_at),
});

const toOrchestryTeam = (raw: Record<string, unknown>): OrchestryTeam => ({
  id: str(raw.id),
  name: str(raw.name),
  description: strOrNull(raw.description),
  status: str(raw.status, "unknown"),
  leadAgentId: str(raw.lead_agent_id),
  memberAgentIds: records(raw.members).map((member) => str(member.agent_id)),
  taskIds: strings(raw.task_pool),
});

const toOrchestryRun = (raw: Record<string, unknown>): OrchestryRun => {
  const tokens = isRecord(raw.tokens) ? raw.tokens : undefined;
  return {
    id: str(raw.id),
    taskId: str(raw.task_id),
    agentId: str(raw.agent_id),
    attempt: int(raw.attempt, 1),
    status: str(raw.status, "unknown"),
    startedAt: str(raw.started_at),
    finishedAt: strOrNull(raw.finished_at),
    error: strOrNull(raw.error),
    tokensTotal: tokens === undefined ? null : int(tokens.total),
  };
};

/** Parses `git diff --numstat` output; binary files report `-` counts. */
export const parseNumstat = (output: string) =>
  output
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 3)
    .slice(0, MAX_INTEGRATION_FILES)
    .map(([additions = "-", deletions = "-", ...rest]) => ({
      path: rest.join("\t"),
      additions: additions === "-" ? null : Number(additions),
      deletions: deletions === "-" ? null : Number(deletions),
    }));

export interface OrchestryCreateTask {
  readonly title: string;
  readonly description?: string;
  readonly priority?: number;
  readonly assigneeId?: string;
  readonly goalId?: string;
}

export class OrchestryService extends Context.Service<
  OrchestryService,
  {
    readonly overview: (projectId: ProjectId) => Effect.Effect<OrchestryOverview, OrchestryError>;
    /** Sets up the integration worktree and ORCH state. Idempotent. */
    readonly enable: (
      projectId: ProjectId,
      adapter: OrchestryAgentAdapter,
    ) => Effect.Effect<OrchestryOverview, OrchestryError>;
    /**
     * Stops ORCH and removes the integration worktree with ORCH's state. The integration
     * branch and its commits are kept.
     */
    readonly disable: (projectId: ProjectId) => Effect.Effect<OrchestryOverview, OrchestryError>;
    readonly start: (
      projectId: ProjectId,
      options?: OrchestryRuntime.OrchestryStartOptions,
    ) => Effect.Effect<OrchestryRuntimeStatus, OrchestryError>;
    readonly stop: (projectId: ProjectId) => Effect.Effect<OrchestryRuntimeStatus, OrchestryError>;
    readonly events: (
      projectId: ProjectId,
      afterSequence?: number,
    ) => Stream.Stream<OrchestryEvent, OrchestryError>;
    readonly listRuns: (
      projectId: ProjectId,
      taskId?: string,
    ) => Effect.Effect<ReadonlyArray<OrchestryRun>, OrchestryError>;
    readonly createTask: (
      projectId: ProjectId,
      input: OrchestryCreateTask,
    ) => Effect.Effect<OrchestryTask, OrchestryError>;
    readonly assignTask: (
      projectId: ProjectId,
      taskId: string,
      agentId: string,
    ) => Effect.Effect<void, OrchestryError>;
    readonly cancelTask: (
      projectId: ProjectId,
      taskId: string,
    ) => Effect.Effect<void, OrchestryError>;
    /** Sends a failed or cancelled task back to `todo`. */
    readonly retryTask: (
      projectId: ProjectId,
      taskId: string,
    ) => Effect.Effect<void, OrchestryError>;
    readonly approveTask: (
      projectId: ProjectId,
      taskId: string,
    ) => Effect.Effect<void, OrchestryError>;
    readonly rejectTask: (
      projectId: ProjectId,
      taskId: string,
      reason?: string,
    ) => Effect.Effect<void, OrchestryError>;
    readonly createAgent: (
      projectId: ProjectId,
      input: {
        readonly name: string;
        readonly adapter: OrchestryAgentAdapter;
        readonly role?: string;
        readonly model?: string;
      },
    ) => Effect.Effect<OrchestryAgent, OrchestryError>;
    readonly removeAgent: (
      projectId: ProjectId,
      agentId: string,
    ) => Effect.Effect<void, OrchestryError>;
    readonly createGoal: (
      projectId: ProjectId,
      input: { readonly title: string; readonly description?: string },
    ) => Effect.Effect<OrchestryGoal, OrchestryError>;
    readonly setGoalStatus: (
      projectId: ProjectId,
      goalId: string,
      status: OrchestryGoalStatus,
    ) => Effect.Effect<void, OrchestryError>;
    readonly createTeam: (
      projectId: ProjectId,
      input: {
        readonly name: string;
        readonly description?: string;
        readonly memberAgentIds: ReadonlyArray<string>;
      },
    ) => Effect.Effect<OrchestryTeam, OrchestryError>;
    readonly disbandTeam: (
      projectId: ProjectId,
      teamId: string,
    ) => Effect.Effect<void, OrchestryError>;
    readonly integrationDiff: (
      projectId: ProjectId,
      path?: string,
    ) => Effect.Effect<{ readonly patch: string; readonly truncated: boolean }, OrchestryError>;
    /** Merges the user's current branch into the integration branch. ORCH must be stopped. */
    readonly syncIntegration: (
      projectId: ProjectId,
    ) => Effect.Effect<OrchestryOverview, OrchestryError>;
    /**
     * Merges the integration branch into the user's checked-out branch: the one operation
     * that writes to the user's checkout. Refuses a dirty checkout and aborts on conflict.
     */
    readonly mergeIntegration: (
      projectId: ProjectId,
    ) => Effect.Effect<OrchestryOverview, OrchestryError>;
  }
>()("t3/orchestry/OrchestryService") {}

/** @public */
export const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const workspace = yield* OrchestryWorkspace.OrchestryWorkspace;
  const runtime = yield* OrchestryRuntime.OrchestryRuntime;
  const cli = yield* OrchestryCli.OrchestryCli;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;

  const project = Effect.fn("OrchestryService.project")(function* (projectId: ProjectId) {
    const found = yield* projects
      .getById(projectId)
      .pipe(
        Effect.mapError(
          (error) => new OrchestryError({ reason: "internal", message: error.message }),
        ),
      );
    if (Option.isNone(found)) return yield* fail("project-not-found", "The project was not found.");
    return found.value;
  });

  const isEnabled = (projectId: ProjectId) =>
    fileSystem.exists(workspace.paths(projectId).stateDir).pipe(Effect.orElseSucceed(() => false));

  /** The integration root of an enabled project, or `not-enabled`. */
  const enabledRoot = Effect.fn("OrchestryService.enabledRoot")(function* (projectId: ProjectId) {
    yield* project(projectId);
    if (!(yield* isEnabled(projectId))) {
      return yield* fail("not-enabled", "Orchestry is not enabled for this project.");
    }
    return workspace.paths(projectId).integrationRoot;
  });

  const git = Effect.fn("OrchestryService.git")(function* (
    cwd: string,
    args: ReadonlyArray<string>,
  ) {
    const output = yield* processRunner
      .run({
        command: "git",
        args,
        cwd,
        timeout: "60 seconds",
        maxOutputBytes: MAX_DIFF_CHARS * 4,
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(
          (cause) => new OrchestryError({ reason: "git-failed", message: cause.message }),
        ),
      );
    return {
      code: output.code === null ? null : Number(output.code),
      stdout: output.stdout,
      stderr: output.stderr,
    };
  });

  const gitOk = Effect.fn("OrchestryService.gitOk")(function* (
    cwd: string,
    args: ReadonlyArray<string>,
  ) {
    const output = yield* git(cwd, args);
    if (output.code !== 0) {
      return yield* fail(
        "git-failed",
        `git ${args[0]} failed: ${OrchestryCli.sanitizeOrchestryOutput(output.stderr)}`,
      );
    }
    return output.stdout.trim();
  });

  const orchJson = (cwd: string, operation: string, args: ReadonlyArray<string>) =>
    cli.runJson({ operation, cwd, args }).pipe(Effect.mapError(toOrchestryError));
  const orchText = (cwd: string, operation: string, args: ReadonlyArray<string>) =>
    cli.runText({ operation, cwd, args }).pipe(Effect.asVoid, Effect.mapError(toOrchestryError));
  /** Positional values only; option values use `--name=value`, which commander never reads as a flag. */
  const argument = (name: string, value: string) =>
    OrchestryCli.orchestryArgument(name, value).pipe(Effect.mapError(toOrchestryError));

  const integration = Effect.fn("OrchestryService.integration")(function* (
    projectId: ProjectId,
    workspaceRoot: string,
  ) {
    const { branch } = workspace.paths(projectId);
    const head = yield* gitOk(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const counts = yield* gitOk(workspaceRoot, [
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...${branch}`,
    ]);
    const [behind = "0", ahead = "0"] = counts.split(/\s+/);
    const numstat = yield* gitOk(workspaceRoot, ["diff", "--numstat", `HEAD...${branch}`]);
    const status = yield* gitOk(workspaceRoot, ["status", "--porcelain"]);
    return {
      branch,
      userBranch: head === "HEAD" ? null : head,
      ahead: Number(ahead),
      behind: Number(behind),
      userCheckoutDirty: status.length > 0,
      files: parseNumstat(numstat),
    } satisfies OrchestryIntegration;
  });

  const overview: OrchestryService["Service"]["overview"] = Effect.fn("OrchestryService.overview")(
    function* (projectId) {
      const found = yield* project(projectId);
      const status = yield* runtime.status(projectId);
      if (!(yield* isEnabled(projectId))) {
        const blockedReason = yield* workspace
          .checkProject(found.workspaceRoot)
          .pipe(
            Effect.as(null),
            Effect.catchTags({ OrchestryWorkspaceError: (error) => Effect.succeed(error.detail) }),
          );
        return {
          projectId,
          enabled: false,
          blockedReason,
          status,
          agents: [],
          tasks: [],
          goals: [],
          teams: [],
          integration: null,
        };
      }
      const root = workspace.paths(projectId).integrationRoot;
      const [snapshot, goals, teams, summary] = yield* Effect.all(
        [
          orchJson(root, "status", ["status"]),
          orchJson(root, "goal list", ["goal", "list"]),
          orchJson(root, "team list", ["team", "list"]),
          integration(projectId, found.workspaceRoot),
        ],
        { concurrency: "unbounded" },
      );
      const state = isRecord(snapshot) ? snapshot : {};
      return {
        projectId,
        enabled: true,
        blockedReason: null,
        status,
        agents: records(state.agents).map(toOrchestryAgent),
        tasks: records(state.tasks).map(toOrchestryTask),
        goals: records(goals).map(toOrchestryGoal),
        teams: records(teams).map(toOrchestryTeam),
        integration: summary,
      };
    },
  );

  const enable: OrchestryService["Service"]["enable"] = Effect.fn("OrchestryService.enable")(
    function* (projectId, adapter) {
      const found = yield* project(projectId);
      yield* workspace
        .prepare({
          projectId,
          workspaceRoot: found.workspaceRoot,
          projectName: found.title,
          adapter,
        })
        .pipe(Effect.mapError(toOrchestryError));
      return yield* overview(projectId);
    },
  );

  const disable: OrchestryService["Service"]["disable"] = Effect.fn("OrchestryService.disable")(
    function* (projectId) {
      const found = yield* project(projectId);
      const status = yield* runtime.stop(projectId);
      if (status.state === "external") {
        return yield* fail("already-running-external", "Stop the ORCH started outside T3 first.");
      }
      const { integrationRoot } = workspace.paths(projectId);
      if (yield* fileSystem.exists(integrationRoot).pipe(Effect.orElseSucceed(() => false))) {
        yield* gitOk(found.workspaceRoot, ["worktree", "remove", "--force", integrationRoot]);
      }
      // ORCH's own task worktrees lived inside the removed directory.
      yield* gitOk(found.workspaceRoot, ["worktree", "prune"]);
      return yield* overview(projectId);
    },
  );

  const start: OrchestryService["Service"]["start"] = Effect.fn("OrchestryService.start")(
    function* (projectId, options) {
      yield* enabledRoot(projectId);
      return yield* runtime.start(projectId, options).pipe(Effect.mapError(toOrchestryError));
    },
  );

  const stop: OrchestryService["Service"]["stop"] = Effect.fn("OrchestryService.stop")(
    function* (projectId) {
      yield* project(projectId);
      return yield* runtime.stop(projectId);
    },
  );

  const listRuns: OrchestryService["Service"]["listRuns"] = Effect.fn("OrchestryService.listRuns")(
    function* (projectId, taskId) {
      const root = yield* enabledRoot(projectId);
      const args =
        taskId === undefined
          ? ["logs", "--since", RUN_HISTORY_WINDOW]
          : ["logs", "--task", yield* argument("task id", taskId)];
      const runs = records(yield* orchJson(root, "logs", args)).map(toOrchestryRun);
      return runs.toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
    },
  );

  const createTask: OrchestryService["Service"]["createTask"] = Effect.fn(
    "OrchestryService.createTask",
  )(function* (projectId, input) {
    const root = yield* enabledRoot(projectId);
    const args = ["task", "add", yield* argument("task title", input.title)];
    if (input.description !== undefined && input.description.trim().length > 0) {
      args.push(`--description=${input.description}`);
    }
    if (input.priority !== undefined) args.push("--priority", String(input.priority));
    if (input.assigneeId !== undefined)
      args.push("--assignee", yield* argument("agent id", input.assigneeId));
    if (input.goalId !== undefined)
      args.push("--goal-id", yield* argument("goal id", input.goalId));
    // Isolation is required for every task T3 creates (see OrchestryWorkspace).
    args.push("--workspace-mode", "worktree");
    const created = yield* orchJson(root, "task add", args);
    if (!isRecord(created))
      return yield* fail("orch-command-failed", "ORCH did not return the task.");
    return toOrchestryTask(created);
  });

  const taskCommand = (verb: string) =>
    Effect.fn(`OrchestryService.${verb}Task`)(function* (
      projectId: ProjectId,
      taskId: string,
      ...extra: ReadonlyArray<string>
    ) {
      const root = yield* enabledRoot(projectId);
      yield* orchText(root, `task ${verb}`, [
        "task",
        verb,
        yield* argument("task id", taskId),
        ...extra,
      ]);
    });
  const cancelTask = taskCommand("cancel");
  const retryTask = taskCommand("retry");
  const approveTask = taskCommand("approve");
  const rejectTaskCommand = taskCommand("reject");
  const rejectTask: OrchestryService["Service"]["rejectTask"] = Effect.fn(
    "OrchestryService.rejectTask",
  )(function* (projectId, taskId, reason) {
    if (reason === undefined || reason.trim().length === 0)
      return yield* rejectTaskCommand(projectId, taskId);
    return yield* rejectTaskCommand(projectId, taskId, `--reason=${reason}`);
  });

  const assignTask: OrchestryService["Service"]["assignTask"] = Effect.fn(
    "OrchestryService.assignTask",
  )(function* (projectId, taskId, agentId) {
    const root = yield* enabledRoot(projectId);
    yield* orchText(root, "task assign", [
      "task",
      "assign",
      yield* argument("task id", taskId),
      yield* argument("agent id", agentId),
    ]);
  });

  const createAgent: OrchestryService["Service"]["createAgent"] = Effect.fn(
    "OrchestryService.createAgent",
  )(function* (projectId, input) {
    const root = yield* enabledRoot(projectId);
    const args = [
      "agent",
      "add",
      yield* argument("agent name", input.name),
      "--adapter",
      input.adapter,
    ];
    if (input.role !== undefined && input.role.trim().length > 0) {
      args.push(`--role=${input.role}`);
    }
    if (input.model !== undefined) args.push("--model", yield* argument("model", input.model));
    args.push("--workspace-mode", "worktree");
    const created = yield* orchJson(root, "agent add", args);
    if (!isRecord(created))
      return yield* fail("orch-command-failed", "ORCH did not return the agent.");
    return toOrchestryAgent(created);
  });

  const removeAgent: OrchestryService["Service"]["removeAgent"] = Effect.fn(
    "OrchestryService.removeAgent",
  )(function* (projectId, agentId) {
    const root = yield* enabledRoot(projectId);
    yield* orchText(root, "agent remove", [
      "agent",
      "remove",
      yield* argument("agent id", agentId),
    ]);
  });

  const createGoal: OrchestryService["Service"]["createGoal"] = Effect.fn(
    "OrchestryService.createGoal",
  )(function* (projectId, input) {
    const root = yield* enabledRoot(projectId);
    const args = ["goal", "add", yield* argument("goal title", input.title)];
    if (input.description !== undefined && input.description.trim().length > 0) {
      args.push(`--description=${input.description}`);
    }
    const created = yield* orchJson(root, "goal add", args);
    if (!isRecord(created))
      return yield* fail("orch-command-failed", "ORCH did not return the goal.");
    return toOrchestryGoal(created);
  });

  const setGoalStatus: OrchestryService["Service"]["setGoalStatus"] = Effect.fn(
    "OrchestryService.setGoalStatus",
  )(function* (projectId, goalId, status) {
    const root = yield* enabledRoot(projectId);
    yield* orchJson(root, "goal status", [
      "goal",
      "status",
      yield* argument("goal id", goalId),
      status,
    ]);
  });

  const createTeam: OrchestryService["Service"]["createTeam"] = Effect.fn(
    "OrchestryService.createTeam",
  )(function* (projectId, input) {
    const root = yield* enabledRoot(projectId);
    const members: Array<string> = [];
    for (const id of input.memberAgentIds) members.push(yield* argument("agent id", id));
    const args = [
      "team",
      "create",
      yield* argument("team name", input.name),
      "--members",
      members.join(","),
    ];
    if (input.description !== undefined && input.description.trim().length > 0) {
      args.push(`--description=${input.description}`);
    }
    const created = yield* orchJson(root, "team create", args);
    if (!isRecord(created))
      return yield* fail("orch-command-failed", "ORCH did not return the team.");
    return toOrchestryTeam(created);
  });

  const disbandTeam: OrchestryService["Service"]["disbandTeam"] = Effect.fn(
    "OrchestryService.disbandTeam",
  )(function* (projectId, teamId) {
    const root = yield* enabledRoot(projectId);
    yield* orchText(root, "team disband", ["team", "disband", yield* argument("team id", teamId)]);
  });

  const integrationDiff: OrchestryService["Service"]["integrationDiff"] = Effect.fn(
    "OrchestryService.integrationDiff",
  )(function* (projectId, path) {
    const found = yield* project(projectId);
    yield* enabledRoot(projectId);
    const { branch } = workspace.paths(projectId);
    const args = ["diff", "--no-color", `HEAD...${branch}`];
    if (path !== undefined) args.push("--", path);
    const patch = yield* gitOk(found.workspaceRoot, args);
    return patch.length > MAX_DIFF_CHARS
      ? { patch: patch.slice(0, MAX_DIFF_CHARS), truncated: true }
      : { patch, truncated: false };
  });

  const syncIntegration: OrchestryService["Service"]["syncIntegration"] = Effect.fn(
    "OrchestryService.syncIntegration",
  )(function* (projectId) {
    const found = yield* project(projectId);
    const root = yield* enabledRoot(projectId);
    const status = yield* runtime.status(projectId);
    if (status.state !== "stopped" && status.state !== "failed") {
      return yield* fail(
        "runtime-active",
        "Stop ORCH before syncing: it merges into the same branch.",
      );
    }
    const userBranch = yield* gitOk(found.workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (userBranch === "HEAD")
      return yield* fail("detached-head", "Your checkout is not on a branch.");
    if ((yield* gitOk(root, ["status", "--porcelain"])).length > 0) {
      return yield* fail("integration-dirty", "The integration worktree has uncommitted changes.");
    }
    const merged = yield* git(root, ["merge", "--no-edit", userBranch]);
    if (merged.code !== 0) {
      yield* git(root, ["merge", "--abort"]);
      return yield* fail(
        "merge-conflict",
        `Merging ${userBranch} into the integration branch conflicted and was aborted.`,
      );
    }
    return yield* overview(projectId);
  });

  const mergeIntegration: OrchestryService["Service"]["mergeIntegration"] = Effect.fn(
    "OrchestryService.mergeIntegration",
  )(function* (projectId) {
    const found = yield* project(projectId);
    yield* enabledRoot(projectId);
    const summary = yield* integration(projectId, found.workspaceRoot);
    if (summary.userBranch === null)
      return yield* fail("detached-head", "Your checkout is not on a branch.");
    if (summary.userCheckoutDirty) {
      return yield* fail("user-checkout-dirty", "Commit or stash your changes before merging.");
    }
    if (summary.ahead === 0)
      return yield* fail("nothing-to-merge", "The integration branch has nothing new.");
    const merged = yield* git(found.workspaceRoot, [
      "merge",
      "--no-ff",
      "--no-edit",
      summary.branch,
    ]);
    if (merged.code !== 0) {
      yield* git(found.workspaceRoot, ["merge", "--abort"]);
      return yield* fail(
        "merge-conflict",
        `Merging ${summary.branch} into ${summary.userBranch} conflicted and was aborted. Sync the integration branch first.`,
      );
    }
    return yield* overview(projectId);
  });

  return OrchestryService.of({
    overview,
    enable,
    disable,
    start,
    stop,
    events: (projectId, afterSequence) =>
      Stream.unwrap(project(projectId).pipe(Effect.as(runtime.events(projectId, afterSequence)))),
    listRuns,
    createTask,
    assignTask,
    cancelTask,
    retryTask,
    approveTask,
    rejectTask,
    createAgent,
    removeAgent,
    createGoal,
    setGoalStatus,
    createTeam,
    disbandTeam,
    integrationDiff,
    syncIntegration,
    mergeIntegration,
  });
});

const layer = Layer.effect(OrchestryService, make);

/** The ORCH services with their own dependencies, for the server runtime and tests. */
export const layerWithDependencies = layer.pipe(
  Layer.provideMerge(OrchestryRuntime.layer),
  Layer.provideMerge(OrchestryWorkspace.layer),
  Layer.provideMerge(OrchestryCli.layer),
);
