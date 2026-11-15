import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

/**
 * Runs ORCH's CLI from the `@oxgeneral/orch` dependency. ORCH is always launched as
 * `<node> <dist/cli.js> ...` with an argument array: no shell, no `.cmd` shim, no global
 * install. The installed copy is patched (patches/@oxgeneral__orch@1.0.34.patch) so it
 * never checks for or installs updates.
 */

const ORCH_PACKAGE = "@oxgeneral/orch";
const DEFAULT_TIMEOUT = "30 seconds";
const MAX_ERROR_DETAIL_CHARS = 2_000;
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

export class OrchestryUnsupportedHostError extends Schema.TaggedError<OrchestryUnsupportedHostError>()(
  "OrchestryUnsupportedHostError",
  { reason: Schema.String },
) {
  override get message(): string {
    return `ORCH cannot run on this host: ${this.reason}`;
  }
}

export class OrchestryCliError extends Schema.TaggedError<OrchestryCliError>()(
  "OrchestryCliError",
  {
    operation: Schema.String,
    cwd: Schema.String,
    exitCode: Schema.NullOr(Schema.Number),
    /** ORCH's own error text, stripped of control characters and truncated. */
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `ORCH ${this.operation} failed${this.exitCode === null ? "" : ` (exit ${this.exitCode})`}: ${this.detail}`;
  }
}

export class OrchestryArgumentError extends Schema.TaggedError<OrchestryArgumentError>()(
  "OrchestryArgumentError",
  { argument: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `Invalid ORCH ${this.argument}: ${this.reason}`;
  }
}

/** How to start ORCH on this host: `command ...prefixArgs <ORCH arguments>`. */
export interface OrchestryLaunch {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

export interface OrchestryRunInput {
  readonly operation: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly timeout?: ProcessRunner.ProcessRunInput["timeout"];
}

export class OrchestryCli extends Context.Service<
  OrchestryCli,
  {
    readonly launch: Effect.Effect<OrchestryLaunch, OrchestryUnsupportedHostError>;
    /** Runs a one-shot command with `--json` and returns its parsed stdout. */
    readonly runJson: (
      input: OrchestryRunInput,
    ) => Effect.Effect<unknown, OrchestryCliError | OrchestryUnsupportedHostError>;
    /** Runs a one-shot command whose stdout is human text (for example `init`). */
    readonly runText: (
      input: OrchestryRunInput,
    ) => Effect.Effect<string, OrchestryCliError | OrchestryUnsupportedHostError>;
  }
>()("t3/orchestry/OrchestryCli") {}

const CONTROL_CHARACTERS = /\u001b\[[0-9;]*[A-Za-z]|[\u0000-\u0008\u000b-\u001f\u007f]/g;

export const sanitizeOrchestryOutput = (text: string): string => {
  const clean = text.replace(CONTROL_CHARACTERS, "").trim();
  return clean.length > MAX_ERROR_DETAIL_CHARS
    ? `${clean.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
    : clean;
};

/**
 * A user-supplied value passed as an ORCH positional or option value. ORCH parses its
 * arguments with commander, so a leading `-` could be read as a flag.
 */
export const orchestryArgument = Effect.fn("orchestryArgument")(function* (
  argument: string,
  value: string,
) {
  if (value.trim().length === 0) {
    return yield* new OrchestryArgumentError({ argument, reason: "must not be empty" });
  }
  if (value.startsWith("-")) {
    return yield* new OrchestryArgumentError({ argument, reason: "must not start with '-'" });
  }
  if (value.includes("\u0000")) {
    return yield* new OrchestryArgumentError({ argument, reason: "must not contain NUL" });
  }
  return value;
});

/** The `dist/cli.js` beside the package's ESM entry; the package exports only `.`. */
const resolveOrchestryCliPath = Effect.fn("resolveOrchestryCliPath")(function* () {
  const path = yield* Path.Path;
  const entry = yield* Effect.try({
    try: () => import.meta.resolve(ORCH_PACKAGE),
    catch: () => new OrchestryUnsupportedHostError({ reason: `${ORCH_PACKAGE} is not installed.` }),
  });
  const entryPath = yield* path
    .fromFileUrl(new URL(entry))
    .pipe(
      Effect.mapError(
        () => new OrchestryUnsupportedHostError({ reason: `Cannot locate ${ORCH_PACKAGE}.` }),
      ),
    );
  return path.join(path.dirname(entryPath), "cli.js");
});

/** @public */
export const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const path = yield* Path.Path;
  const isExecutable = yield* HostProcess.IsExecutable;
  const executablePath = yield* HostProcess.ExecutablePath;
  const environment = yield* HostProcess.Environment;

  const cliPath = yield* resolveOrchestryCliPath().pipe(Effect.result);

  const launch: OrchestryCli["Service"]["launch"] = Effect.gen(function* () {
    if (isExecutable) {
      return yield* new OrchestryUnsupportedHostError({
        reason: "the single-file t3 executable has no Node runtime for ORCH's CLI.",
      });
    }
    if (cliPath._tag === "Failure") return yield* cliPath.failure;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(environment)) {
      // The server's own Node flags (source stripping, inspectors) are not ORCH's.
      if (value !== undefined && key !== "NODE_OPTIONS") env[key] = value;
    }
    env.NO_COLOR = "1";
    env.FORCE_COLOR = "0";
    // Desktop hosts the server in Electron; this makes its binary behave as plain Node.
    env.ELECTRON_RUN_AS_NODE = "1";
    return {
      command: executablePath,
      prefixArgs: [path.normalize(cliPath.success)],
      env,
    };
  });

  const execute = Effect.fn("OrchestryCli.execute")(function* (
    input: OrchestryRunInput,
    json: boolean,
  ) {
    yield* Effect.annotateCurrentSpan("orchestry.operation", input.operation);
    const resolved = yield* launch;
    const output = yield* processRunner
      .run({
        command: resolved.command,
        args: [...resolved.prefixArgs, ...(json ? ["--json"] : []), ...input.args],
        cwd: input.cwd,
        env: resolved.env,
        timeout: input.timeout ?? DEFAULT_TIMEOUT,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new OrchestryCliError({
              operation: input.operation,
              cwd: input.cwd,
              exitCode: null,
              detail: cause.message,
              cause,
            }),
        ),
      );
    if (output.code !== 0) {
      return yield* new OrchestryCliError({
        operation: input.operation,
        cwd: input.cwd,
        exitCode: output.code === null ? null : Number(output.code),
        detail:
          sanitizeOrchestryOutput(output.stderr) ||
          sanitizeOrchestryOutput(output.stdout) ||
          "ORCH exited without output.",
      });
    }
    return output.stdout;
  });

  const runText: OrchestryCli["Service"]["runText"] = (input) => execute(input, false);

  const runJson: OrchestryCli["Service"]["runJson"] = Effect.fn("OrchestryCli.runJson")(
    function* (input) {
      const stdout = yield* execute(input, true);
      return yield* decodeJson(stdout).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestryCliError({
              operation: input.operation,
              cwd: input.cwd,
              exitCode: 0,
              detail: `ORCH did not print JSON: ${sanitizeOrchestryOutput(stdout).slice(0, 200)}`,
              cause,
            }),
        ),
      );
    },
  );

  return OrchestryCli.of({ launch, runJson, runText });
});

export const layer = Layer.effect(OrchestryCli, make);
