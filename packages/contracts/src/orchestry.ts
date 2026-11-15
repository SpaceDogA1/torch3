import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId } from "./baseSchemas.ts";

/**
 * ORCH (Orchestry) runs as a supervised `orch serve` process per T3 project.
 * These schemas describe what T3 observes of it; ORCH's own files under
 * `.orchestry/` stay the source of truth for agents, tasks, goals and teams.
 */

/**
 * - `external`: a live ORCH lock exists that this server did not start (for example
 *   one started from a terminal). T3 reports it and never signals it.
 */
export const OrchestryRuntimeState = Schema.Literals([
  "stopped",
  "starting",
  "running",
  "stopping",
  "failed",
  "external",
]);
export type OrchestryRuntimeState = typeof OrchestryRuntimeState.Type;

/** ORCH 1.0.34's `SUPPORTED_ADAPTERS`; `shell` runs a fixed command and needs no provider. */
export const OrchestryAdapter = Schema.Literals([
  "claude",
  "codex",
  "cursor",
  "opencode",
  "pi",
  "grok",
  "antigravity",
  "shell",
]);
export type OrchestryAdapter = typeof OrchestryAdapter.Type;

export const OrchestryRuntimeStatus = Schema.Struct({
  projectId: ProjectId,
  state: OrchestryRuntimeState,
  pid: Schema.NullOr(Schema.Int),
  startedAt: Schema.NullOr(IsoDateTime),
  /** Sanitized reason for the last failure or unexpected exit. */
  lastError: Schema.NullOr(Schema.String),
});
export type OrchestryRuntimeStatus = typeof OrchestryRuntimeStatus.Type;

export const OrchestryLogLevel = Schema.Literals(["debug", "info", "warn", "error"]);
export type OrchestryLogLevel = typeof OrchestryLogLevel.Type;

export const OrchestryEvent = Schema.Struct({
  projectId: ProjectId,
  /** Increases per project across restarts; a reconnecting client resumes after the last one it saw. */
  sequence: Schema.Int,
  ts: IsoDateTime,
  level: OrchestryLogLevel,
  event: Schema.String,
  /** The event's own fields as ORCH logged them, minus `ts`, `level` and `event`. */
  fields: Schema.Record(Schema.String, Schema.Unknown),
});
export type OrchestryEvent = typeof OrchestryEvent.Type;

/*
 * Projections of ORCH's own records for display. Status fields stay plain strings so a
 * newer ORCH with an extra status still decodes; clients handle the values they know.
 */

/** ORCH adapters T3 lets clients create agents with; `shell` would run an arbitrary host command. */
export const OrchestryAgentAdapter = Schema.Literals([
  "claude",
  "codex",
  "cursor",
  "opencode",
  "pi",
  "grok",
  "antigravity",
]);
export type OrchestryAgentAdapter = typeof OrchestryAgentAdapter.Type;

export const OrchestryAgent = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  adapter: Schema.String,
  role: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  status: Schema.String,
  currentTaskId: Schema.NullOr(Schema.String),
  tasksCompleted: Schema.Int,
  tasksFailed: Schema.Int,
  lastError: Schema.NullOr(Schema.String),
});
export type OrchestryAgent = typeof OrchestryAgent.Type;

export const OrchestryTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  /** todo, in_progress, retrying, review, done, failed or cancelled in ORCH 1.0.34. */
  status: Schema.String,
  priority: Schema.Int,
  assigneeId: Schema.NullOr(Schema.String),
  goalId: Schema.NullOr(Schema.String),
  dependsOn: Schema.Array(Schema.String),
  attempts: Schema.Int,
  maxAttempts: Schema.Int,
  branch: Schema.NullOr(Schema.String),
  filesChanged: Schema.Array(Schema.String),
  agentSummary: Schema.NullOr(Schema.String),
  feedback: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type OrchestryTask = typeof OrchestryTask.Type;

export const OrchestryGoalStatus = Schema.Literals(["active", "paused", "achieved", "abandoned"]);
export type OrchestryGoalStatus = typeof OrchestryGoalStatus.Type;

export const OrchestryGoal = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  status: Schema.String,
  assigneeId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type OrchestryGoal = typeof OrchestryGoal.Type;

export const OrchestryTeam = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: Schema.String,
  leadAgentId: Schema.String,
  memberAgentIds: Schema.Array(Schema.String),
  taskIds: Schema.Array(Schema.String),
});
export type OrchestryTeam = typeof OrchestryTeam.Type;

export const OrchestryRun = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  agentId: Schema.String,
  attempt: Schema.Int,
  status: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  tokensTotal: Schema.NullOr(Schema.Int),
});
export type OrchestryRun = typeof OrchestryRun.Type;

export const OrchestryIntegrationFile = Schema.Struct({
  path: Schema.String,
  /** Null for binary files. */
  additions: Schema.NullOr(Schema.Int),
  deletions: Schema.NullOr(Schema.Int),
});

/** The integration branch compared with the user's checked-out branch. */
export const OrchestryIntegration = Schema.Struct({
  branch: Schema.String,
  /** Null when the user's checkout is on a detached HEAD. */
  userBranch: Schema.NullOr(Schema.String),
  /** Commits on the integration branch that the user's branch lacks. */
  ahead: Schema.Int,
  /** Commits on the user's branch that the integration branch lacks. */
  behind: Schema.Int,
  userCheckoutDirty: Schema.Boolean,
  files: Schema.Array(OrchestryIntegrationFile),
});
export type OrchestryIntegration = typeof OrchestryIntegration.Type;

export const OrchestryOverview = Schema.Struct({
  projectId: ProjectId,
  /** ORCH has been set up for this project (its integration worktree exists). */
  enabled: Schema.Boolean,
  status: OrchestryRuntimeStatus,
  agents: Schema.Array(OrchestryAgent),
  tasks: Schema.Array(OrchestryTask),
  goals: Schema.Array(OrchestryGoal),
  teams: Schema.Array(OrchestryTeam),
  integration: Schema.NullOr(OrchestryIntegration),
});
export type OrchestryOverview = typeof OrchestryOverview.Type;

export class OrchestryError extends Schema.TaggedError<OrchestryError>()("OrchestryError", {
  message: Schema.String,
  /** A stable reason clients can branch on, such as `not-enabled` or `user-checkout-dirty`. */
  reason: Schema.String,
}) {}

const ProjectInput = { projectId: ProjectId };
const OrchestryId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const OrchestryText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
const OrchestryLongText = Schema.String.check(Schema.isMaxLength(20_000));

export const OrchestryProjectInput = Schema.Struct(ProjectInput);
export const OrchestryEnableInput = Schema.Struct({
  ...ProjectInput,
  adapter: OrchestryAgentAdapter,
});
export const OrchestryStartInput = Schema.Struct({
  ...ProjectInput,
  verbose: Schema.optionalKey(Schema.Boolean),
});
export const OrchestrySubscribeEventsInput = Schema.Struct({
  ...ProjectInput,
  afterSequence: Schema.optionalKey(Schema.Int),
});
export const OrchestryListRunsInput = Schema.Struct({
  ...ProjectInput,
  taskId: Schema.optionalKey(OrchestryId),
});
export const OrchestryCreateTaskInput = Schema.Struct({
  ...ProjectInput,
  title: OrchestryText,
  description: Schema.optionalKey(OrchestryLongText),
  priority: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))),
  assigneeId: Schema.optionalKey(OrchestryId),
  goalId: Schema.optionalKey(OrchestryId),
});
export const OrchestryTaskInput = Schema.Struct({ ...ProjectInput, taskId: OrchestryId });
export const OrchestryAssignTaskInput = Schema.Struct({
  ...ProjectInput,
  taskId: OrchestryId,
  agentId: OrchestryId,
});
export const OrchestryRejectTaskInput = Schema.Struct({
  ...ProjectInput,
  taskId: OrchestryId,
  reason: Schema.optionalKey(OrchestryLongText),
});
export const OrchestryCreateAgentInput = Schema.Struct({
  ...ProjectInput,
  name: OrchestryText,
  adapter: OrchestryAgentAdapter,
  role: Schema.optionalKey(OrchestryLongText),
  model: Schema.optionalKey(OrchestryText),
});
export const OrchestryAgentInput = Schema.Struct({ ...ProjectInput, agentId: OrchestryId });
export const OrchestryCreateGoalInput = Schema.Struct({
  ...ProjectInput,
  title: OrchestryText,
  description: Schema.optionalKey(OrchestryLongText),
});
export const OrchestrySetGoalStatusInput = Schema.Struct({
  ...ProjectInput,
  goalId: OrchestryId,
  status: OrchestryGoalStatus,
});
export const OrchestryCreateTeamInput = Schema.Struct({
  ...ProjectInput,
  name: OrchestryText,
  description: Schema.optionalKey(OrchestryLongText),
  memberAgentIds: Schema.Array(OrchestryId).check(Schema.isMinLength(1)),
});
export const OrchestryTeamInput = Schema.Struct({ ...ProjectInput, teamId: OrchestryId });
export const OrchestryIntegrationDiffInput = Schema.Struct({
  ...ProjectInput,
  path: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_096))),
});
export const OrchestryIntegrationDiff = Schema.Struct({
  patch: Schema.String,
  truncated: Schema.Boolean,
});
