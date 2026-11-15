import { OrchestratorMcpFailure, OrchestryError, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as OrchestryService from "../../../orchestry/OrchestryService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, resolveProjectId } from "../../threadAccess.ts";
import { OrchestryToolkit } from "./tools.ts";

const toFailure = (error: OrchestryError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "project-not-found" ? "invalid_request" : "orchestration_error",
    message: `${error.message} (${error.reason})`,
  });

/** Runs `use` for the named project, or the calling thread's project. */
const forProject = Effect.fn("OrchestryMcp.forProject")(function* <A>(
  projectId: ProjectId | undefined,
  use: (
    service: OrchestryService.OrchestryService["Service"],
    id: ProjectId,
  ) => Effect.Effect<A, OrchestryError>,
) {
  const id = yield* resolveProjectId(yield* readCaller(), projectId);
  const service = yield* OrchestryService.OrchestryService;
  return yield* use(service, id).pipe(Effect.mapError(toFailure));
});

const ok = { ok: true as const };

export const layer = McpToolAccess.toLayer(OrchestryToolkit, {
  orchestry_status: McpToolAccess.reads((input) =>
    forProject(input.projectId, (service, id) => service.overview(id)),
  ),
  orchestry_list_runs: McpToolAccess.reads((input) =>
    forProject(input.projectId, (service, id) => service.listRuns(id, input.taskId)),
  ),
  orchestry_enable: McpToolAccess.writes((input) =>
    forProject(input.projectId, (service, id) => service.enable(id, input.adapter)),
  ),
  orchestry_start: McpToolAccess.writes((input) =>
    forProject(input.projectId, (service, id) => service.start(id)),
  ),
  orchestry_stop: McpToolAccess.writes((input) =>
    forProject(input.projectId, (service, id) => service.stop(id)),
  ),
  orchestry_create_agent: McpToolAccess.writes(({ projectId, ...agent }) =>
    forProject(projectId, (service, id) =>
      service.createAgent(id, agent).pipe(Effect.map(({ id }) => ({ id }))),
    ),
  ),
  orchestry_create_task: McpToolAccess.writes(({ projectId, ...task }) =>
    forProject(projectId, (service, id) =>
      service.createTask(id, task).pipe(Effect.map(({ id }) => ({ id }))),
    ),
  ),
  orchestry_update_task: McpToolAccess.writes((input) =>
    forProject(input.projectId, (service, id) => {
      switch (input.action) {
        case "assign":
          return input.agentId === undefined
            ? Effect.fail(
                new OrchestryError({
                  reason: "invalid-argument",
                  message: "assign needs agentId.",
                }),
              )
            : service.assignTask(id, input.taskId, input.agentId).pipe(Effect.as(ok));
        case "cancel":
          return service.cancelTask(id, input.taskId).pipe(Effect.as(ok));
        case "retry":
          return service.retryTask(id, input.taskId).pipe(Effect.as(ok));
      }
    }),
  ),
  orchestry_create_goal: McpToolAccess.writes(({ projectId, ...goal }) =>
    forProject(projectId, (service, id) =>
      service.createGoal(id, goal).pipe(Effect.map(({ id }) => ({ id }))),
    ),
  ),
  orchestry_create_team: McpToolAccess.writes(({ projectId, ...team }) =>
    forProject(projectId, (service, id) =>
      service.createTeam(id, team).pipe(Effect.map(({ id }) => ({ id }))),
    ),
  ),
} satisfies McpToolAccess.Handlers<typeof OrchestryToolkit.tools>);
