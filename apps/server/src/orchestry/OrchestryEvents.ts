import * as Schema from "effect/Schema";

import { OrchestryLogLevel, type OrchestryEvent, type ProjectId } from "@t3tools/contracts";

/** Longer string fields (agent stderr, merge conflict text) are cut to this many characters. */
export const MAX_EVENT_FIELD_CHARS = 4_000;
/** Longer stdout lines are not JSON log records worth keeping; they are reported as malformed. */
const MAX_LOG_LINE_CHARS = 64_000;

const ServeLogRecord = Schema.Struct({
  ts: Schema.String,
  level: OrchestryLogLevel,
  event: Schema.String,
});
const decodeServeLogRecord = Schema.decodeUnknownOption(ServeLogRecord);

export type ServeLogLine =
  | { readonly _tag: "Event"; readonly event: OrchestryEvent }
  | { readonly _tag: "Malformed"; readonly preview: string };

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…[truncated ${value.length - max} chars]` : value;

const boundFieldValue = (value: unknown): unknown => {
  if (typeof value === "string") return truncate(value, MAX_EVENT_FIELD_CHARS);
  if (value === null || typeof value !== "object") return value;
  const serialized = JSON.stringify(value);
  return serialized.length > MAX_EVENT_FIELD_CHARS
    ? truncate(serialized, MAX_EVENT_FIELD_CHARS)
    : value;
};

const parseJsonObject = (line: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Parses one stdout line of `orch serve --log-format json`. Lines that are not ORCH log
 * records (a stray warning, a partial write) come back as `Malformed` with a short preview
 * instead of failing, so one bad line never stops the event stream.
 */
export function parseServeLogLine(
  line: string,
  projectId: ProjectId,
  sequence: number,
): ServeLogLine {
  const trimmed = line.trim();
  const preview = truncate(trimmed, 200);
  if (trimmed.length === 0 || trimmed.length > MAX_LOG_LINE_CHARS) {
    return { _tag: "Malformed", preview };
  }
  const object = parseJsonObject(trimmed);
  if (object === undefined) return { _tag: "Malformed", preview };
  const record = decodeServeLogRecord(object);
  if (record._tag === "None") return { _tag: "Malformed", preview };

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (key === "ts" || key === "level" || key === "event") continue;
    fields[key] = boundFieldValue(value);
  }
  return {
    _tag: "Event",
    event: {
      projectId,
      sequence,
      ts: record.value.ts,
      level: record.value.level,
      event: record.value.event,
      fields,
    },
  };
}
