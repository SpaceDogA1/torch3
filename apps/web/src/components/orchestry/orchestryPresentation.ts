import type { OrchestryAgentAdapter, OrchestryRuntimeState } from "@t3tools/contracts";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "error" | "info";

export const ADAPTER_OPTIONS: ReadonlyArray<{
  readonly value: OrchestryAgentAdapter;
  readonly label: string;
}> = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
  { value: "opencode", label: "OpenCode" },
  { value: "pi", label: "Pi" },
  { value: "grok", label: "Grok" },
  { value: "antigravity", label: "Antigravity" },
];

export function runtimeBadge(state: OrchestryRuntimeState): {
  readonly label: string;
  readonly variant: BadgeVariant;
} {
  switch (state) {
    case "running":
      return { label: "Running", variant: "success" };
    case "starting":
      return { label: "Starting", variant: "info" };
    case "stopping":
      return { label: "Stopping", variant: "info" };
    case "failed":
      return { label: "Failed", variant: "error" };
    case "external":
      return { label: "Running outside T3", variant: "warning" };
    case "stopped":
      return { label: "Stopped", variant: "secondary" };
  }
}

/** Badge colour for ORCH task, run, agent, goal and team statuses. */
export function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "done":
    case "succeeded":
    case "achieved":
    case "active":
      return "success";
    case "in_progress":
    case "running":
    case "preparing":
      return "info";
    case "review":
    case "retrying":
    case "paused":
      return "warning";
    case "failed":
    case "timed_out":
    case "error":
      return "error";
    default:
      return "secondary";
  }
}

export const humanizeStatus = (status: string) => status.replaceAll("_", " ");

/** The server's typed message when there is one; ORCH and Git details are already sanitized. */
export function orchestryErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object" && "message" in error) {
    const message = (error as { readonly message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Something went wrong talking to this environment.";
}
