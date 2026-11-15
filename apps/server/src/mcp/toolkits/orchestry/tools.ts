import {
  OrchestratorMcpFailure,
  OrchestryAgentAdapter,
  OrchestryCreateAgentInput,
  OrchestryCreateGoalInput,
  OrchestryCreateTaskInput,
  OrchestryCreateTeamInput,
  OrchestryOverview,
  OrchestryRun,
  OrchestryRuntimeStatus,
  ProjectId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ProjectService from "../../../project/ProjectService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as OrchestryService from "../../../orchestry/OrchestryService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/*
 * ORCH (Orchestry) runs its own agents on this environment, in an integration worktree
 * of the project. Merging that work into the user's checkout is deliberately not a tool:
 * it is an explicit user action in the app.
 */

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectService.ProjectService,
  ThreadManagementService.ThreadManagementService,
  OrchestryService.OrchestryService,
];

const projectId = Schema.optional(ProjectId).annotate({
  description: "Omit for this thread's project.",
});
const OkResult = Schema.Struct({ ok: Schema.Literal(true) });
/** Full records come from orchestry_status; a create only needs to say what it made. */
const CreatedResult = Schema.Struct({ id: Schema.String });

const StatusTool = Tool.make("orchestry_status", {
  description:
    "ORCH (Orchestry, a multi-agent orchestrator separate from T3 threads): enabled or not, runtime, agents, tasks, goals, teams, and its integration branch versus the user's branch.",
  parameters: Schema.Struct({ projectId }),
  success: OrchestryOverview,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Get Orchestry status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const EnableTool = Tool.make("orchestry_enable", {
  description:
    "Set up ORCH for a project. Its agents work and merge on an integration branch, never the user's checkout. Needs a Git repository root with a commit.",
  parameters: Schema.Struct({ projectId, adapter: OrchestryAgentAdapter }),
  success: OrchestryOverview,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Enable Orchestry")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const StartTool = Tool.make("orchestry_start", {
  description:
    "Start ORCH. It runs `todo` tasks; unassigned ones go to any idle agent, which uses the user's provider credits.",
  parameters: Schema.Struct({ projectId }),
  success: OrchestryRuntimeStatus,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Start Orchestry")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const StopTool = Tool.make("orchestry_stop", {
  description:
    "Stop the project's ORCH runtime. Running agent work is cancelled and retried later.",
  parameters: Schema.Struct({ projectId }),
  success: OrchestryRuntimeStatus,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Stop Orchestry")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const CreateAgentTool = Tool.make("orchestry_create_agent", {
  description: "Add an ORCH agent. `role` is its standing instruction.",
  parameters: Schema.Struct({ ...OrchestryCreateAgentInput.fields, projectId }),
  success: CreatedResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create Orchestry agent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const CreateTaskTool = Tool.make("orchestry_create_task", {
  description:
    "Queue an ORCH task. `assigneeId` is an agent id from orchestry_status. Priority 1 is highest.",
  parameters: Schema.Struct({ ...OrchestryCreateTaskInput.fields, projectId }),
  success: CreatedResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create Orchestry task")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const UpdateTaskTool = Tool.make("orchestry_update_task", {
  description:
    "Change an ORCH task: `assign` (needs agentId), `cancel`, or `retry` a failed or cancelled task.",
  parameters: Schema.Struct({
    projectId,
    taskId: Schema.String,
    action: Schema.Literals(["assign", "cancel", "retry"]),
    agentId: Schema.optional(Schema.String),
  }),
  success: OkResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Update Orchestry task")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const CreateGoalTool = Tool.make("orchestry_create_goal", {
  description: "Add an ORCH goal. Link tasks to it with `goalId` in orchestry_create_task.",
  parameters: Schema.Struct({ ...OrchestryCreateGoalInput.fields, projectId }),
  success: CreatedResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create Orchestry goal")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const CreateTeamTool = Tool.make("orchestry_create_team", {
  description: "Group ORCH agents into a team. The first member leads it.",
  parameters: Schema.Struct({ ...OrchestryCreateTeamInput.fields, projectId }),
  success: CreatedResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Create Orchestry team")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ListRunsTool = Tool.make("orchestry_list_runs", {
  description: "ORCH agent runs, newest first: the last 30 days, or one task's.",
  parameters: Schema.Struct({ projectId, taskId: Schema.optional(Schema.String) }),
  success: Schema.Array(OrchestryRun),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List Orchestry runs")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const OrchestryToolkit = Toolkit.make(
  StatusTool,
  EnableTool,
  StartTool,
  StopTool,
  CreateAgentTool,
  CreateTaskTool,
  UpdateTaskTool,
  CreateGoalTool,
  CreateTeamTool,
  ListRunsTool,
);
