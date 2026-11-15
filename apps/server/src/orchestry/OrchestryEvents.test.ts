import { describe, expect, it } from "@effect/vitest";

import { ProjectId } from "@t3tools/contracts";

import { MAX_EVENT_FIELD_CHARS, parseServeLogLine } from "./OrchestryEvents.ts";

const projectId = ProjectId.make("project-1");

describe("parseServeLogLine", () => {
  it("splits an ORCH serve record into envelope and fields", () => {
    const line = JSON.stringify({
      ts: "2026-11-15T15:00:01.448Z",
      level: "info",
      event: "agent:completed",
      runId: "run_Qyk-BIk",
      agentId: "agt_yb2xJOd",
      success: true,
    });
    expect(parseServeLogLine(line, projectId, 7)).toEqual({
      _tag: "Event",
      event: {
        projectId,
        sequence: 7,
        ts: "2026-11-15T15:00:01.448Z",
        level: "info",
        event: "agent:completed",
        fields: { runId: "run_Qyk-BIk", agentId: "agt_yb2xJOd", success: true },
      },
    });
  });

  it("passes through event names this version does not know", () => {
    const line = JSON.stringify({ ts: "t", level: "warn", event: "future:thing", x: 1 });
    const parsed = parseServeLogLine(line, projectId, 1);
    expect(parsed._tag === "Event" && parsed.event.event).toBe("future:thing");
  });

  it.each([
    ["an empty line", ""],
    ["plain text", "warning: in the working copy of 'a.txt'"],
    ["a partial JSON write", '{"ts":"2026-11-15T15:00:00.471Z","level":"in'],
    ["a JSON array", "[1,2]"],
    ["a record without an event name", JSON.stringify({ ts: "t", level: "info" })],
    ["an unknown level", JSON.stringify({ ts: "t", level: "fatal", event: "x" })],
  ])("reports %s as malformed instead of failing", (_name, line) => {
    expect(parseServeLogLine(line, projectId, 1)._tag).toBe("Malformed");
  });

  it("bounds large field values so agent stderr cannot grow the buffer", () => {
    const line = JSON.stringify({
      ts: "t",
      level: "error",
      event: "agent:error",
      error: "x".repeat(MAX_EVENT_FIELD_CHARS * 3),
      nested: { text: "y".repeat(MAX_EVENT_FIELD_CHARS * 3) },
    });
    const parsed = parseServeLogLine(line, projectId, 1);
    if (parsed._tag !== "Event") throw new Error("expected an event");
    expect(String(parsed.event.fields.error).length).toBeLessThan(MAX_EVENT_FIELD_CHARS + 100);
    expect(typeof parsed.event.fields.nested).toBe("string");
    expect(String(parsed.event.fields.nested).length).toBeLessThan(MAX_EVENT_FIELD_CHARS + 100);
  });
});
