import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import {
  ORCHESTRY_TABS,
  OrchestryPage,
  type OrchestrySearch,
  type OrchestryTab,
} from "../components/orchestry/OrchestryPage";

export const Route = createFileRoute("/_chat/orchestry")({
  validateSearch: (raw: Record<string, unknown>): OrchestrySearch => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(ORCHESTRY_TABS.some((tab) => tab.value === raw.tab)
      ? { tab: raw.tab as OrchestryTab }
      : {}),
  }),
  component: OrchestryPage,
});
