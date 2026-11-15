import {
  WS_METHODS,
  type EnvironmentId,
  type OrchestryEvent,
  type OrchestryGoal,
  type OrchestryTask,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Recent ORCH events kept per project for the activity feed. */
const ORCHESTRY_ACTIVITY_LIMIT = 200;

/** Events that never change what the overview shows; the rest prompt a refetch. */
const NON_STATE_EVENTS: ReadonlySet<string> = new Set([
  "orchestrator:tick",
  "agent:output",
  "agent:file_changed",
  "message:sent",
  "message:delivered",
]);

export const isOrchestryStateEvent = (event: OrchestryEvent): boolean =>
  !NON_STATE_EVENTS.has(event.event);

const field = (event: OrchestryEvent, name: string): string => {
  const value = event.fields[name];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
};

/** One line for the activity feed, from ORCH's own event fields. */
export function describeOrchestryEvent(event: OrchestryEvent): string {
  switch (event.event) {
    case "serve:started":
      return "ORCH started";
    case "orchestrator:shutdown":
      return `ORCH stopped (${field(event, "reason") || "shutdown"})`;
    case "task:created":
      return "Task created";
    case "task:assigned":
      return `Task ${field(event, "taskId")} assigned to ${field(event, "agentId")}`;
    case "task:status_changed":
      return `Task ${field(event, "taskId")}: ${field(event, "from")} → ${field(event, "to")}`;
    case "agent:started":
      return `Agent ${field(event, "agentId")} started task ${field(event, "taskId")}`;
    case "agent:completed":
      return `Agent ${field(event, "agentId")} ${event.fields.success === true ? "finished" : "failed"} run ${field(event, "runId")}`;
    case "agent:error":
      return `Agent ${field(event, "agentId")}: ${field(event, "error")}`;
    case "run:retry":
      return `Run ${field(event, "runId")} retrying (attempt ${field(event, "attempt")})`;
    case "workspace:merge_succeeded":
      return `Merged ${field(event, "branch")} into the integration branch`;
    case "workspace:merge_conflict":
      return `Merge conflict on ${field(event, "branch")}; task sent to review`;
    case "orchestrator:error":
      return `ORCH error: ${field(event, "error")}`;
    case "goal:created":
      return `Goal created: ${field(event, "title")}`;
    case "goal:status_changed":
      return `Goal ${field(event, "goalId")}: ${field(event, "from")} → ${field(event, "to")}`;
    case "team:created":
      return `Team created: ${field(event, "name")}`;
    case "team:disbanded":
      return `Team ${field(event, "teamId")} disbanded`;
    default:
      return event.event;
  }
}

/** ORCH 1.0.34 task statuses, in board order; anything newer lands in `other`. */
const ORCHESTRY_TASK_COLUMNS = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "retrying", label: "Retrying" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
  { status: "cancelled", label: "Cancelled" },
] as const;

export function groupOrchestryTasks(tasks: ReadonlyArray<OrchestryTask>) {
  const known = new Set<string>(ORCHESTRY_TASK_COLUMNS.map((column) => column.status));
  const groups = ORCHESTRY_TASK_COLUMNS.map((column) => ({
    ...column,
    tasks: tasks
      .filter((task) => task.status === column.status)
      .sort((left, right) => left.priority - right.priority),
  }));
  const other = tasks.filter((task) => !known.has(task.status));
  return other.length === 0
    ? groups
    : [...groups, { status: "other", label: "Other", tasks: other }];
}

/** Progress from the goal's own tasks; null when it has none to measure. */
export function orchestryGoalProgress(goal: OrchestryGoal, tasks: ReadonlyArray<OrchestryTask>) {
  const own = tasks.filter((task) => task.goalId === goal.id && task.status !== "cancelled");
  if (own.length === 0) return null;
  const done = own.filter((task) => task.status === "done").length;
  return { done, total: own.length };
}

export function createOrchestryEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const events = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:orchestry:events",
    tag: WS_METHODS.orchestrySubscribeEvents,
    transform: (stream) =>
      stream.pipe(
        Stream.scan(
          (): ReadonlyArray<OrchestryEvent> => [],
          (recent, event: OrchestryEvent) => [...recent, event].slice(-ORCHESTRY_ACTIVITY_LIMIT),
        ),
      ),
  });

  /** Changes on each state-changing ORCH event, so the overview refetches only then. */
  const stateRevision = Atom.family((key: string) => {
    const [environmentId, projectId] = JSON.parse(key) as [EnvironmentId, ProjectId];
    return Atom.make((get) => {
      const result = get(events({ environmentId, input: { projectId } }));
      if (!AsyncResult.isSuccess(result)) return 0;
      return result.value.findLast(isOrchestryStateEvent)?.sequence ?? 0;
    });
  });

  const overview = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:orchestry:overview",
    tag: WS_METHODS.orchestryGetOverview,
    staleTimeMs: 2_000,
    refreshTrigger: ({ environmentId, input }) =>
      stateRevision(JSON.stringify([environmentId, input.projectId])),
  });

  const command = <T extends Parameters<typeof createEnvironmentRpcCommand>[1]["tag"]>(
    name: string,
    tag: T,
  ) =>
    createEnvironmentRpcCommand(runtime, {
      label: `environment-data:orchestry:${name}`,
      tag,
      // Results show up through the event stream and the overview refetch it triggers;
      // refetching here as well covers commands ORCH reports no event for.
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() => {
          const projectId = (input as { readonly projectId?: ProjectId }).projectId;
          if (projectId !== undefined) {
            registry.refresh(overview({ environmentId, input: { projectId } }));
          }
        }),
    });

  return {
    overview,
    events,
    runs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestry:runs",
      tag: WS_METHODS.orchestryListRuns,
      staleTimeMs: 5_000,
    }),
    integrationDiff: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:orchestry:integration-diff",
      tag: WS_METHODS.orchestryGetIntegrationDiff,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    enable: command("enable", WS_METHODS.orchestryEnable),
    disable: command("disable", WS_METHODS.orchestryDisable),
    start: command("start", WS_METHODS.orchestryStart),
    stop: command("stop", WS_METHODS.orchestryStop),
    createTask: command("create-task", WS_METHODS.orchestryCreateTask),
    assignTask: command("assign-task", WS_METHODS.orchestryAssignTask),
    cancelTask: command("cancel-task", WS_METHODS.orchestryCancelTask),
    retryTask: command("retry-task", WS_METHODS.orchestryRetryTask),
    approveTask: command("approve-task", WS_METHODS.orchestryApproveTask),
    rejectTask: command("reject-task", WS_METHODS.orchestryRejectTask),
    createAgent: command("create-agent", WS_METHODS.orchestryCreateAgent),
    removeAgent: command("remove-agent", WS_METHODS.orchestryRemoveAgent),
    createGoal: command("create-goal", WS_METHODS.orchestryCreateGoal),
    setGoalStatus: command("set-goal-status", WS_METHODS.orchestrySetGoalStatus),
    createTeam: command("create-team", WS_METHODS.orchestryCreateTeam),
    disbandTeam: command("disband-team", WS_METHODS.orchestryDisbandTeam),
    syncIntegration: command("sync-integration", WS_METHODS.orchestrySyncIntegration),
    mergeIntegration: command("merge-integration", WS_METHODS.orchestryMergeIntegration),
  };
}
