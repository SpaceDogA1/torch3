import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import type {
  OrchestryEvent,
  OrchestryRuntimeState,
  OrchestryRuntimeStatus,
  ProjectId,
} from "@t3tools/contracts";

import * as OrchestryCli from "./OrchestryCli.ts";
import { parseServeLogLine } from "./OrchestryEvents.ts";
import * as OrchestryWorkspace from "./OrchestryWorkspace.ts";

/**
 * ORCH stops gracefully only on SIGINT/SIGTERM, which Windows cannot send to a child. This
 * preload turns a `stop` line, or stdin closing (as when this server dies), into that
 * in-process SIGTERM. See docs/internals/orchestry.md.
 */

const STOP_BOOTSTRAP = [
  "let asked=false;",
  "const stop=()=>{if(asked)return;asked=true;process.stdin.pause();process.stdin.unref?.();process.emit('SIGTERM','SIGTERM')};",
  "process.stdin.on('data',(b)=>{if(String(b).includes('stop'))stop()});",
  "process.stdin.on('end',stop);",
  "process.stdin.on('error',stop);",
].join("");
const STOP_BOOTSTRAP_IMPORT = `data:text/javascript,${encodeURIComponent(STOP_BOOTSTRAP)}`;

const STARTUP_TIMEOUT = "20 seconds";
const GRACEFUL_STOP_TIMEOUT = "30 seconds";
/** Matches ORCH's own stale-lock age (`LOCK_STALE_MS` in its lock.ts). */
const LOCK_STALE_MS = 60_000;
const RECENT_EVENTS_LIMIT = 500;
const EVENT_PUBSUB_CAPACITY = 1_024;
const STDERR_TAIL_LINES = 20;

export class OrchestryRuntimeError extends Schema.TaggedError<OrchestryRuntimeError>()(
  "OrchestryRuntimeError",
  {
    reason: Schema.Literals(["already-running-external", "spawn-failed", "startup-failed"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

interface ManagedRuntime {
  readonly pid: number;
  readonly scope: Scope.Closeable;
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  readonly startedAt: string;
  readonly stopRequested: Deferred.Deferred<void>;
  readonly started: Deferred.Deferred<void>;
  readonly exited: Deferred.Deferred<void>;
  state: OrchestryRuntimeState;
  stderrTail: Array<string>;
}

interface ProjectRecord {
  managed: ManagedRuntime | undefined;
  lastError: string | null;
  recent: Array<OrchestryEvent>;
  /** Keeps increasing across restarts, so `afterSequence` stays meaningful to clients. */
  sequence: number;
}

export interface OrchestryStartOptions {
  /** Adds ORCH's high-volume `agent:output` events. */
  readonly verbose?: boolean;
}

export class OrchestryRuntime extends Context.Service<
  OrchestryRuntime,
  {
    readonly start: (
      projectId: ProjectId,
      options?: OrchestryStartOptions,
    ) => Effect.Effect<
      OrchestryRuntimeStatus,
      | OrchestryRuntimeError
      | OrchestryWorkspace.OrchestryIsolationError
      | OrchestryWorkspace.OrchestryWorkspaceError
      | OrchestryCli.OrchestryUnsupportedHostError
    >;
    /** Stops only a process this server started. An `external` runtime is left alone. */
    readonly stop: (projectId: ProjectId) => Effect.Effect<OrchestryRuntimeStatus>;
    readonly status: (projectId: ProjectId) => Effect.Effect<OrchestryRuntimeStatus>;
    /**
     * The buffered events after `afterSequence` (up to the last 500), then live events,
     * with no gap or duplicate between the two. A reconnecting client passes the last
     * sequence it saw.
     */
    readonly events: (
      projectId: ProjectId,
      afterSequence?: number,
    ) => Stream.Stream<OrchestryEvent>;
  }
>()("t3/orchestry/OrchestryRuntime") {}

/** True when the PID exists; EPERM means it exists but belongs to someone else. */
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** @public */
export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const workspace = yield* OrchestryWorkspace.OrchestryWorkspace;
  const cli = yield* OrchestryCli.OrchestryCli;
  const runtimeScope = yield* Effect.scope;

  const projects = new Map<ProjectId, ProjectRecord>();
  const lifecycle = yield* Semaphore.make(1);
  const pubsub = yield* PubSub.sliding<OrchestryEvent>(EVENT_PUBSUB_CAPACITY);

  const recordFor = (projectId: ProjectId): ProjectRecord => {
    let record = projects.get(projectId);
    if (record === undefined) {
      record = { managed: undefined, lastError: null, recent: [], sequence: 0 };
      projects.set(projectId, record);
    }
    return record;
  };

  /** A live ORCH lock this server does not own: started from a terminal or a previous run. */
  const externalLockPid = Effect.fn("OrchestryRuntime.externalLockPid")(function* (
    projectId: ProjectId,
  ) {
    const { lockPath } = workspace.paths(projectId);
    const text = yield* fileSystem
      .readFileString(lockPath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (text === undefined) return undefined;
    const pid = Number.parseInt(text.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0 || !isProcessAlive(pid)) return undefined;
    const info = yield* fileSystem.stat(lockPath).pipe(Effect.orElseSucceed(() => undefined));
    const modified = info?.mtime._tag === "Some" ? info.mtime.value.getTime() : 0;
    const now = yield* Clock.currentTimeMillis;
    return now - modified <= LOCK_STALE_MS ? pid : undefined;
  });

  const statusOf = Effect.fn("OrchestryRuntime.statusOf")(function* (projectId: ProjectId) {
    const record = recordFor(projectId);
    const managed = record.managed;
    if (managed !== undefined) {
      return {
        projectId,
        state: managed.state,
        pid: managed.pid,
        startedAt: managed.startedAt,
        lastError: record.lastError,
      } satisfies OrchestryRuntimeStatus;
    }
    const externalPid = yield* externalLockPid(projectId);
    return {
      projectId,
      state:
        externalPid === undefined ? (record.lastError === null ? "stopped" : "failed") : "external",
      pid: externalPid ?? null,
      startedAt: null,
      lastError: record.lastError,
    } satisfies OrchestryRuntimeStatus;
  });

  const publish = (record: ProjectRecord, event: OrchestryEvent) =>
    Effect.suspend(() => {
      record.recent.push(event);
      if (record.recent.length > RECENT_EVENTS_LIMIT) record.recent.shift();
      return PubSub.publish(pubsub, event);
    });

  const observeStdout = (projectId: ProjectId, record: ProjectRecord, managed: ManagedRuntime) =>
    managed.child.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => {
        const parsed = parseServeLogLine(line, projectId, record.sequence + 1);
        if (parsed._tag === "Malformed") {
          return parsed.preview.length === 0
            ? Effect.void
            : Effect.logDebug("Ignored non-JSON ORCH output", { projectId, line: parsed.preview });
        }
        record.sequence = parsed.event.sequence;
        const markStarted =
          parsed.event.event === "serve:started"
            ? Effect.suspend(() => {
                if (managed.state === "starting") managed.state = "running";
                return Deferred.succeed(managed.started, undefined);
              })
            : Effect.void;
        return markStarted.pipe(Effect.andThen(publish(record, parsed.event)));
      }),
      Effect.ignore,
    );

  const observeStderr = (managed: ManagedRuntime) =>
    managed.child.stderr.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) =>
        Effect.sync(() => {
          const clean = OrchestryCli.sanitizeOrchestryOutput(line);
          if (clean.length === 0) return;
          managed.stderrTail.push(clean);
          if (managed.stderrTail.length > STDERR_TAIL_LINES) managed.stderrTail.shift();
        }),
      ),
      Effect.ignore,
    );

  /** Requests a graceful stop, then ends stdin, which the preload treats the same way. */
  const feedStdin = (managed: ManagedRuntime) =>
    Stream.fromEffect(Deferred.await(managed.stopRequested)).pipe(
      Stream.as("stop\n"),
      Stream.encodeText,
      Stream.run(managed.child.stdin),
      Effect.ignore,
    );

  const superviseExit = (projectId: ProjectId, record: ProjectRecord, managed: ManagedRuntime) =>
    managed.child.exitCode.pipe(
      Effect.result,
      Effect.flatMap((exit) =>
        Effect.suspend(() => {
          const code = exit._tag === "Success" ? Number(exit.success) : null;
          const expected = managed.state === "stopping";
          if (!expected) {
            const tail = managed.stderrTail.join("\n");
            record.lastError = `ORCH exited unexpectedly${code === null ? "" : ` with code ${code}`}${tail ? `: ${tail}` : "."}`;
          } else if (code !== 0 && code !== null) {
            record.lastError = `ORCH stopped with exit code ${code}.`;
          } else {
            record.lastError = null;
          }
          if (record.managed === managed) record.managed = undefined;
          return Effect.logInfo("ORCH runtime exited", {
            projectId,
            pid: managed.pid,
            code,
            expected,
          });
        }),
      ),
      Effect.andThen(Deferred.succeed(managed.exited, undefined)),
      Effect.andThen(Effect.forkIn(Scope.close(managed.scope, Exit.void), runtimeScope)),
    );

  const startUnlocked = Effect.fn("OrchestryRuntime.startProcess")(function* (
    projectId: ProjectId,
    options: OrchestryStartOptions,
  ) {
    const record = recordFor(projectId);
    if (record.managed !== undefined && record.managed.state !== "stopping") {
      return yield* statusOf(projectId);
    }
    if (record.managed !== undefined) yield* Deferred.await(record.managed.exited);

    const externalPid = yield* externalLockPid(projectId);
    if (externalPid !== undefined) {
      return yield* new OrchestryRuntimeError({
        reason: "already-running-external",
        detail: `ORCH is already running for this project (pid ${externalPid}), started outside this T3 server.`,
      });
    }

    const paths = workspace.paths(projectId);
    yield* workspace.validateIsolation(paths.integrationRoot);
    const launch = yield* cli.launch;

    const scope = yield* Scope.make("sequential");
    const child = yield* spawner
      .spawn(
        ChildProcess.make(
          launch.command,
          [
            "--import",
            STOP_BOOTSTRAP_IMPORT,
            ...launch.prefixArgs,
            "serve",
            "--log-format",
            "json",
            ...(options.verbose === true ? ["--verbose"] : []),
          ],
          {
            cwd: paths.integrationRoot,
            env: launch.env,
            extendEnv: false,
            shell: false,
            detached: false,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            forceKillAfter: "5 seconds",
          },
        ),
      )
      .pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.catch((cause) =>
          Scope.close(scope, Exit.void).pipe(
            Effect.andThen(
              new OrchestryRuntimeError({
                reason: "spawn-failed",
                detail: "ORCH could not be started.",
                cause,
              }),
            ),
          ),
        ),
      );

    const managed: ManagedRuntime = {
      pid: Number(child.pid),
      scope,
      child,
      startedAt: DateTime.formatIso(yield* DateTime.now),
      stopRequested: yield* Deferred.make<void>(),
      started: yield* Deferred.make<void>(),
      exited: yield* Deferred.make<void>(),
      state: "starting",
      stderrTail: [],
    };
    record.managed = managed;
    record.lastError = null;
    yield* Effect.forkIn(observeStdout(projectId, record, managed), scope);
    yield* Effect.forkIn(observeStderr(managed), scope);
    yield* Effect.forkIn(feedStdin(managed), scope);
    yield* Effect.forkIn(superviseExit(projectId, record, managed), runtimeScope);

    const startup = yield* Effect.raceFirst(
      Deferred.await(managed.started).pipe(Effect.as("started" as const)),
      Deferred.await(managed.exited).pipe(Effect.as("exited" as const)),
    ).pipe(Effect.timeoutOption(STARTUP_TIMEOUT));
    if (startup._tag === "Some" && startup.value === "started") {
      yield* Effect.logInfo("ORCH runtime started", { projectId, pid: managed.pid });
      return yield* statusOf(projectId);
    }
    if (startup._tag === "None") {
      managed.state = "stopping";
      yield* child.kill().pipe(Effect.ignore);
      yield* Deferred.await(managed.exited);
      record.lastError = "ORCH did not report serve:started in time.";
    }
    return yield* new OrchestryRuntimeError({
      reason: "startup-failed",
      detail: record.lastError ?? "ORCH exited during startup.",
    });
  });

  const stopUnlocked = Effect.fn("OrchestryRuntime.stopProcess")(function* (projectId: ProjectId) {
    const managed = recordFor(projectId).managed;
    if (managed === undefined) return yield* statusOf(projectId);
    managed.state = "stopping";
    yield* Deferred.succeed(managed.stopRequested, undefined);
    const graceful = yield* Deferred.await(managed.exited).pipe(
      Effect.timeoutOption(GRACEFUL_STOP_TIMEOUT),
    );
    if (graceful._tag === "None") {
      yield* Effect.logWarning("ORCH did not stop gracefully; killing it", {
        projectId,
        pid: managed.pid,
      });
      yield* managed.child.kill().pipe(Effect.ignore);
      yield* Deferred.await(managed.exited);
    }
    return yield* statusOf(projectId);
  });

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...projects.keys()], (projectId) => stopUnlocked(projectId), {
      concurrency: "unbounded",
      discard: true,
    }),
  );

  return OrchestryRuntime.of({
    start: Effect.fn("OrchestryRuntime.start")(function* (projectId, options = {}) {
      return yield* lifecycle.withPermits(1)(startUnlocked(projectId, options));
    }),
    stop: Effect.fn("OrchestryRuntime.stop")(function* (projectId) {
      return yield* lifecycle.withPermits(1)(stopUnlocked(projectId));
    }),
    status: statusOf,
    events: (projectId, afterSequence = 0) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before taking the snapshot: an event published in between is in
          // both, and the sequence filter drops the second copy.
          const subscription = yield* PubSub.subscribe(pubsub);
          const snapshot = recordFor(projectId).recent.filter(
            (event) => event.sequence > afterSequence,
          );
          const replayedThrough = snapshot.at(-1)?.sequence ?? afterSequence;
          return Stream.concat(
            Stream.fromIterable(snapshot),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter(
                (event) => event.projectId === projectId && event.sequence > replayedThrough,
              ),
            ),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(OrchestryRuntime, make);
