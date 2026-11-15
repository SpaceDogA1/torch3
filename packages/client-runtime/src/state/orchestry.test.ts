import { describe, expect, it } from "vite-plus/test";

import { ProjectId, type OrchestryEvent, type OrchestryTask } from "@t3tools/contracts";

import {
  describeOrchestryEvent,
  groupOrchestryTasks,
  isOrchestryStateEvent,
  orchestryGoalProgress,
} from "./orchestry.ts";

const event = (name: string, fields: Record<string, unknown> = {}): OrchestryEvent => ({
  projectId: ProjectId.make("p"),
  sequence: 1,
  ts: "2026-11-15T15:00:00.000Z",
  level: "info",
  event: name,
  fields,
});

const task = (id: string, status: string, extra: Partial<OrchestryTask> = {}): OrchestryTask => ({
  id,
  title: id,
  description: "",
  status,
  priority: 3,
  assigneeId: null,
  goalId: null,
  dependsOn: [],
  attempts: 0,
  maxAttempts: 3,
  branch: null,
  filesChanged: [],
  agentSummary: null,
  feedback: null,
  createdAt: "",
  updatedAt: "",
  ...extra,
});

describe("Orchestry client helpers", () => {
  it("refetches on state changes but not on ORCH's periodic ticks or agent output", () => {
    expect(isOrchestryStateEvent(event("task:status_changed"))).toBe(true);
    expect(isOrchestryStateEvent(event("orchestrator:tick"))).toBe(false);
    expect(isOrchestryStateEvent(event("agent:output"))).toBe(false);
  });

  it("reports a run's outcome from agent:completed, not from agent:error noise", () => {
    expect(
      describeOrchestryEvent(event("agent:completed", { agentId: "a", runId: "r", success: true })),
    ).toContain("finished");
    expect(
      describeOrchestryEvent(
        event("agent:completed", { agentId: "a", runId: "r", success: false }),
      ),
    ).toContain("failed");
  });

  it("keeps tasks with a status this client does not know in their own group", () => {
    const groups = groupOrchestryTasks([
      task("b", "todo", { priority: 2 }),
      task("a", "todo", { priority: 1 }),
      task("c", "blocked_upstream"),
    ]);
    expect(groups.find((group) => group.status === "todo")?.tasks.map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
    expect(groups.at(-1)).toMatchObject({ status: "other", tasks: [{ id: "c" }] });
  });

  it("measures goal progress from the goal's own unfinished and done tasks only", () => {
    const goal = {
      id: "g",
      title: "",
      description: "",
      status: "active",
      assigneeId: null,
      createdAt: "",
    };
    expect(orchestryGoalProgress(goal, [])).toBeNull();
    expect(
      orchestryGoalProgress(goal, [
        task("1", "done", { goalId: "g" }),
        task("2", "todo", { goalId: "g" }),
        task("3", "cancelled", { goalId: "g" }),
        task("4", "done"),
      ]),
    ).toEqual({ done: 1, total: 2 });
  });
});
