import { describe, expect, it } from "@effect/vitest";

import { findIsolationViolations, orchestryProjectSlug } from "./OrchestryWorkspace.ts";

const worktreeConfig = { defaults: { agent: { workspace_mode: "worktree" } } };

describe("findIsolationViolations", () => {
  it("accepts ORCH's default worktree config and modes left unset", () => {
    expect(
      findIsolationViolations({
        config: worktreeConfig,
        agents: [{ file: "agt_a.yml", document: { config: { command: "x" } } }],
        tasks: [{ file: "tsk_a.yml", document: { status: "todo" } }],
      }),
    ).toEqual([]);
  });

  it.each([
    [
      "a shared default",
      { config: { defaults: { agent: { workspace_mode: "shared" } } }, agents: [], tasks: [] },
    ],
    [
      "an agent overriding to shared",
      {
        config: worktreeConfig,
        agents: [{ file: "agt_a.yml", document: { config: { workspace_mode: "shared" } } }],
        tasks: [],
      },
    ],
    [
      "an unfinished task in isolated mode",
      {
        config: worktreeConfig,
        agents: [],
        tasks: [{ file: "tsk_a.yml", document: { status: "review", workspace_mode: "isolated" } }],
      },
    ],
  ])("rejects %s", (_name, input) => {
    expect(findIsolationViolations(input)).toHaveLength(1);
  });

  it("ignores finished tasks, which no agent will run again", () => {
    expect(
      findIsolationViolations({
        config: worktreeConfig,
        agents: [],
        tasks: [
          { file: "tsk_a.yml", document: { status: "done", workspace_mode: "shared" } },
          { file: "tsk_b.yml", document: { status: "cancelled", workspace_mode: "shared" } },
        ],
      }),
    ).toEqual([]);
  });
});

describe("orchestryProjectSlug", () => {
  it.each([
    ["project-1", "project-1"],
    ["a/b c:d", "a-b-c-d"],
    ["..hidden", "hidden"],
    ["///", "project"],
  ])("maps %s to %s", (input, expected) => {
    expect(orchestryProjectSlug(input)).toBe(expected);
  });
});
