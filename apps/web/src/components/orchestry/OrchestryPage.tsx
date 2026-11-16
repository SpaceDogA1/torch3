import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type OrchestryAgentAdapter,
  type OrchestryOverview,
  type ProjectId,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { useNavigate, useSearch } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { readEnvironmentScope } from "../../state/session";
import { useProjects } from "../../state/entities";
import { orchestryEnvironment } from "../../state/orchestry";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { ADAPTER_OPTIONS, orchestryErrorMessage, runtimeBadge } from "./orchestryPresentation";
import { useOrchestryCommand } from "./useOrchestryCommand";
import {
  ActivitySection,
  AgentsSection,
  GoalsSection,
  OverviewSection,
  ReviewSection,
  RunsSection,
  TasksSection,
  TeamsSection,
} from "./OrchestrySections";

export const ORCHESTRY_TABS = [
  { value: "overview", label: "Overview" },
  { value: "tasks", label: "Tasks" },
  { value: "agents", label: "Agents" },
  { value: "teams", label: "Teams" },
  { value: "goals", label: "Goals" },
  { value: "runs", label: "Runs" },
  { value: "activity", label: "Activity" },
  { value: "review", label: "Review" },
] as const;

export type OrchestryTab = (typeof ORCHESTRY_TABS)[number]["value"];

export interface OrchestrySearch {
  readonly environmentId?: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly tab?: OrchestryTab;
}

export interface OrchestryTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** Whether this client's token may start, stop and change ORCH work here. */
  readonly canOperate: boolean;
}

const projectKey = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;

export function OrchestryPage() {
  const search = useSearch({ from: "/_chat/orchestry" });
  const navigate = useNavigate({ from: "/orchestry" });
  const projects = useProjects().filter((project) => project.isScratch !== true);
  const selected =
    projects.find(
      (project) =>
        project.id === search.projectId &&
        (search.environmentId === undefined || project.environmentId === search.environmentId),
    ) ?? projects[0];
  const tab = search.tab ?? "overview";

  return (
    <ScrollArea className="h-full">
      <WorkspacePageContainer width="expanded">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-xl">Orchestry</h1>
            <p className="text-muted-foreground text-sm">
              ORCH runs teams of agents on a project's integration branch. Nothing reaches your
              checkout until you merge it.
            </p>
          </div>
          {projects.length > 0 && selected !== undefined ? (
            <Select
              value={projectKey(selected)}
              onValueChange={(value) => {
                const next = projects.find((project) => projectKey(project) === value);
                if (next === undefined) return;
                void navigate({
                  search: { environmentId: next.environmentId, projectId: next.id, tab },
                });
              }}
            >
              <SelectTrigger aria-label="Project" className="w-64">
                <SelectValue>{selected.title}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {projects.map((project) => (
                  <SelectItem key={projectKey(project)} value={projectKey(project)}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
        </header>
        {selected === undefined ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>Add a project to run ORCH agents on it.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ProjectOrchestry
            key={projectKey(selected)}
            target={{
              environmentId: selected.environmentId,
              projectId: selected.id,
              canOperate: readEnvironmentScope(
                selected.environmentId,
                AuthOrchestrationOperateScope,
              ),
            }}
            tab={tab}
            onTab={(next) => void navigate({ search: { ...search, tab: next } })}
          />
        )}
      </WorkspacePageContainer>
    </ScrollArea>
  );
}

function ProjectOrchestry({
  target,
  tab,
  onTab,
}: {
  readonly target: OrchestryTarget;
  readonly tab: OrchestryTab;
  readonly onTab: (tab: OrchestryTab) => void;
}) {
  const result = useAtomValue(
    orchestryEnvironment.overview({
      environmentId: target.environmentId,
      input: { projectId: target.projectId },
    }),
  );

  if (AsyncResult.isFailure(result)) {
    return (
      <Alert variant="error">
        <AlertTitle>Could not load Orchestry</AlertTitle>
        <AlertDescription>{orchestryErrorMessage(Cause.squash(result.cause))}</AlertDescription>
      </Alert>
    );
  }
  if (!AsyncResult.isSuccess(result)) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const overview = result.value;
  if (!overview.enabled) {
    return <EnableOrchestry target={target} blockedReason={overview.blockedReason} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <RuntimeBar target={target} overview={overview} />
      <ToggleGroup
        aria-label="Orchestry section"
        variant="segmented"
        value={[tab]}
        onValueChange={(next) => {
          const value = next[0] as OrchestryTab | undefined;
          if (value !== undefined) onTab(value);
        }}
      >
        {ORCHESTRY_TABS.map((item) => (
          <Toggle key={item.value} value={item.value}>
            {item.label}
          </Toggle>
        ))}
      </ToggleGroup>
      {tab === "overview" ? <OverviewSection target={target} overview={overview} /> : null}
      {tab === "tasks" ? <TasksSection target={target} overview={overview} /> : null}
      {tab === "agents" ? <AgentsSection target={target} overview={overview} /> : null}
      {tab === "teams" ? <TeamsSection target={target} overview={overview} /> : null}
      {tab === "goals" ? <GoalsSection target={target} overview={overview} /> : null}
      {tab === "runs" ? <RunsSection target={target} overview={overview} /> : null}
      {tab === "activity" ? <ActivitySection target={target} /> : null}
      {tab === "review" ? <ReviewSection target={target} overview={overview} /> : null}
    </div>
  );
}

function RuntimeBar({
  target,
  overview,
}: {
  readonly target: OrchestryTarget;
  readonly overview: OrchestryOverview;
}) {
  const start = useOrchestryCommand(orchestryEnvironment.start, "Start ORCH");
  const stop = useOrchestryCommand(orchestryEnvironment.stop, "Stop ORCH");
  const [busy, setBusy] = useState(false);
  const { status } = overview;
  const badge = runtimeBadge(status.state);
  const running = status.state === "running" || status.state === "starting";
  const input = { projectId: target.projectId };

  const act = async (action: "start" | "stop") => {
    setBusy(true);
    await (action === "start"
      ? start({ environmentId: target.environmentId, input })
      : stop({ environmentId: target.environmentId, input }));
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {status.pid !== null ? (
          <span className="text-muted-foreground text-xs">pid {status.pid}</span>
        ) : null}
        <span className="text-muted-foreground text-xs">
          Branch <code>{overview.integration?.branch}</code>
        </span>
        <div className="ms-auto flex gap-2">
          {running ? (
            <Button
              variant="outline"
              disabled={busy || !target.canOperate || status.state === "starting"}
              onClick={() => void act("stop")}
            >
              Stop
            </Button>
          ) : (
            <Button
              disabled={busy || !target.canOperate || status.state === "external"}
              onClick={() => void act("start")}
            >
              Start
            </Button>
          )}
        </div>
      </div>
      {status.state === "external" ? (
        <Alert variant="warning">
          <AlertDescription>
            ORCH is already running for this project outside T3 (pid {status.pid}). Stop it there to
            manage it here.
          </AlertDescription>
        </Alert>
      ) : null}
      {status.lastError !== null ? (
        <Alert variant="error">
          <AlertTitle>ORCH stopped unexpectedly</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{status.lastError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function EnableOrchestry({
  target,
  blockedReason,
}: {
  readonly target: OrchestryTarget;
  readonly blockedReason: string | null;
}) {
  const enable = useOrchestryCommand(orchestryEnvironment.enable, "Enable Orchestry");
  const [adapter, setAdapter] = useState<OrchestryAgentAdapter>("claude");
  const [busy, setBusy] = useState(false);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Orchestry is off for this project</EmptyTitle>
        <EmptyDescription>
          Enabling creates an integration branch and worktree for ORCH. The project must be the root
          of its own Git repository with at least one commit. ORCH agents use your provider
          subscriptions when they run.
        </EmptyDescription>
      </EmptyHeader>
      {blockedReason !== null ? (
        <Alert variant="warning">
          <AlertTitle>This project can't run ORCH</AlertTitle>
          <AlertDescription>{blockedReason}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center gap-2">
        <Select
          value={adapter}
          onValueChange={(value) => setAdapter(value as OrchestryAgentAdapter)}
        >
          <SelectTrigger aria-label="Default agent provider" className="w-44">
            <SelectValue>
              {ADAPTER_OPTIONS.find((option) => option.value === adapter)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {ADAPTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          disabled={busy || !target.canOperate || blockedReason !== null}
          onClick={async () => {
            setBusy(true);
            await enable({
              environmentId: target.environmentId,
              input: { projectId: target.projectId, adapter },
            });
            setBusy(false);
          }}
        >
          Enable Orchestry
        </Button>
      </div>
    </Empty>
  );
}
