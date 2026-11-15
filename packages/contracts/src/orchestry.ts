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
