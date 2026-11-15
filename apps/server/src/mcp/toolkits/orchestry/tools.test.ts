import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { OrchestryToolkit } from "./tools.ts";

describe("OrchestryToolkit", () => {
  it("keeps Git writes to the user's checkout and teardown out of agents' reach", () => {
    const names = Object.keys(OrchestryToolkit.tools);
    for (const forbidden of ["merge", "sync", "disable", "diff"]) {
      expect(names.filter((name) => name.includes(forbidden))).toEqual([]);
    }
  });

  it("does not let an agent create a shell agent, which would run any host command", () => {
    const decode = Schema.decodeUnknownExit(
      OrchestryToolkit.tools.orchestry_create_agent.parametersSchema as Schema.Decoder<unknown>,
    );
    expect(decode({ name: "x", adapter: "shell" })._tag).toBe("Failure");
    expect(decode({ name: "x", adapter: "claude" })._tag).toBe("Success");
  });
});
