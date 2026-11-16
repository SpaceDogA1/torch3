import { useAtomValue } from "@effect/atom-react";
import type {
  OrchestryAgent,
  OrchestryAgentAdapter,
  OrchestryGoalStatus,
  OrchestryOverview,
  OrchestryTask,
} from "@t3tools/contracts";
import {
  describeOrchestryEvent,
  groupOrchestryTasks,
  orchestryGoalProgress,
} from "@t3tools/client-runtime/state/orchestry";
import * as Cause from "effect/Cause";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactNode } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { orchestryEnvironment } from "../../state/orchestry";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Textarea } from "../ui/textarea";
import type { OrchestryTarget } from "./OrchestryPage";
import {
  ADAPTER_OPTIONS,
  humanizeStatus,
  orchestryErrorMessage,
  statusVariant,
} from "./orchestryPresentation";
import { useOrchestryCommand } from "./useOrchestryCommand";

interface SectionProps {
  readonly target: OrchestryTarget;
  readonly overview: OrchestryOverview;
}

const confirm = async (message: string, destructive = false) =>
  (await requestConfirmDialog(message, destructive ? { variant: "destructive" } : undefined)) ??
  window.confirm(message);

function Section({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="font-medium text-base">{title}</h2>
        <div className="ms-auto flex gap-2">{action}</div>
      </div>
      {children}
    </section>
  );
}

function EmptySection({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Empty size="compact">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function StatusBadge({ status }: { readonly status: string }) {
  return <Badge variant={statusVariant(status)}>{humanizeStatus(status)}</Badge>;
}

const agentName = (agents: ReadonlyArray<OrchestryAgent>, id: string | null) =>
  id === null ? "Unassigned" : (agents.find((agent) => agent.id === id)?.name ?? id);

/** Runs a command with a busy flag; `useOrchestryCommand` toasts failures. */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    await work().finally(() => setBusy(false));
  };
  return [busy, run] as const;
}

function Stat({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-semibold text-lg tabular-nums">{value}</span>
    </div>
  );
}

export function OverviewSection({ target, overview }: SectionProps) {
  const active = overview.tasks.filter(
    (task) => task.status === "in_progress" || task.status === "retrying",
  ).length;
  const review = overview.tasks.filter((task) => task.status === "review").length;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Agents" value={overview.agents.length} />
        <Stat label="Active tasks" value={active} />
        <Stat label="Awaiting review" value={review} />
        <Stat label="Commits to merge" value={overview.integration?.ahead ?? 0} />
      </div>
      {overview.agents.length === 0 ? (
        <Alert variant="info">
          <AlertDescription>
            Add an agent before creating tasks. ORCH gives unassigned tasks to any idle agent, and
            each run uses that agent's provider subscription.
          </AlertDescription>
        </Alert>
      ) : null}
      <Section title="Recent activity">
        <ActivityList target={target} limit={8} />
      </Section>
    </div>
  );
}

export function TasksSection({ target, overview }: SectionProps) {
  const [creating, setCreating] = useState(false);
  const groups = groupOrchestryTasks(overview.tasks).filter((group) => group.tasks.length > 0);
  return (
    <Section
      title="Tasks"
      action={
        <Button size="sm" disabled={!target.canOperate} onClick={() => setCreating(true)}>
          New task
        </Button>
      }
    >
      {groups.length === 0 ? (
        <EmptySection title="No tasks" description="Create a task and assign it to an agent." />
      ) : (
        groups.map((group) => (
          <div key={group.status} className="flex flex-col gap-2">
            <h3 className="font-medium text-muted-foreground text-sm">
              {group.label} · {group.tasks.length}
            </h3>
            {group.tasks.map((task) => (
              <TaskRow key={task.id} target={target} overview={overview} task={task} />
            ))}
          </div>
        ))
      )}
      {creating ? (
        <CreateTaskDialog target={target} overview={overview} onClose={() => setCreating(false)} />
      ) : null}
    </Section>
  );
}

function TaskRow({ target, overview, task }: SectionProps & { readonly task: OrchestryTask }) {
  const assign = useOrchestryCommand(orchestryEnvironment.assignTask, "Assign task");
  const cancel = useOrchestryCommand(orchestryEnvironment.cancelTask, "Cancel task");
  const retry = useOrchestryCommand(orchestryEnvironment.retryTask, "Retry task");
  const approve = useOrchestryCommand(orchestryEnvironment.approveTask, "Approve task");
  const reject = useOrchestryCommand(orchestryEnvironment.rejectTask, "Reject task");
  const [busy, run] = useBusy();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const target_ = { environmentId: target.environmentId };
  const input = { projectId: target.projectId, taskId: task.id };
  const disabled = busy || !target.canOperate;
  const open =
    task.status === "todo" || task.status === "in_progress" || task.status === "retrying";

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{task.title}</span>
          <StatusBadge status={task.status} />
          <Badge variant="outline">P{task.priority}</Badge>
        </div>
        {task.description ? (
          <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">{task.description}</p>
        ) : null}
        <p className="mt-1 text-muted-foreground text-xs">
          {agentName(overview.agents, task.assigneeId)} · attempt {task.attempts}/{task.maxAttempts}
          {task.branch !== null ? ` · ${task.branch}` : ""}
        </p>
        {task.feedback !== null ? (
          <p className="mt-1 text-warning-foreground text-xs">Feedback: {task.feedback}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {task.status === "todo" && overview.agents.length > 0 ? (
          <Select
            value={task.assigneeId ?? ""}
            disabled={disabled}
            onValueChange={(agentId) => {
              if (!agentId) return;
              void run(() => assign({ ...target_, input: { ...input, agentId: String(agentId) } }));
            }}
          >
            <SelectTrigger aria-label={`Assign ${task.title}`} size="sm" className="w-40">
              <SelectValue>{agentName(overview.agents, task.assigneeId)}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {overview.agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        {task.status === "review" ? (
          <>
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => void run(() => approve({ ...target_, input }))}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setRejecting(true)}
            >
              Reject
            </Button>
          </>
        ) : null}
        {task.status === "failed" || task.status === "cancelled" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void run(() => retry({ ...target_, input }))}
          >
            Retry
          </Button>
        ) : null}
        {open ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={async () => {
              if (!(await confirm(`Cancel "${task.title}"? A running agent is stopped.`, true)))
                return;
              await run(() => cancel({ ...target_, input }));
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
      {rejecting ? (
        <FormDialog
          title={`Send "${task.title}" back`}
          submitLabel="Reject"
          canSubmit
          onClose={() => setRejecting(false)}
          onSubmit={async () => {
            const result = await reject({
              ...target_,
              input: reason.trim() === "" ? input : { ...input, reason },
            });
            return result._tag === "Success";
          }}
        >
          <Field label="What should the agent fix? (optional)">
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              autoFocus
            />
          </Field>
        </FormDialog>
      ) : null}
    </div>
  );
}

function FormDialog({
  title,
  submitLabel,
  canSubmit,
  onSubmit,
  onClose,
  children,
}: {
  readonly title: string;
  readonly submitLabel: string;
  readonly canSubmit: boolean;
  readonly onSubmit: () => Promise<boolean>;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canSubmit || busy) return;
            setBusy(true);
            const ok = await onSubmit();
            setBusy(false);
            if (ok) onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">{children}</div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex flex-col items-stretch gap-1.5 font-medium text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CreateTaskDialog({
  target,
  overview,
  onClose,
}: SectionProps & { readonly onClose: () => void }) {
  const create = useOrchestryCommand(orchestryEnvironment.createTask, "Create task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [priority, setPriority] = useState("3");
  return (
    <FormDialog
      title="New task"
      submitLabel="Create task"
      canSubmit={title.trim().length > 0 && !title.trim().startsWith("-")}
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          environmentId: target.environmentId,
          input: {
            projectId: target.projectId,
            title: title.trim(),
            priority: Number(priority),
            ...(description.trim() ? { description } : {}),
            ...(assigneeId ? { assigneeId } : {}),
            ...(goalId ? { goalId } : {}),
          },
        });
        return result._tag === "Success";
      }}
    >
      <Field label="Title">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </Field>
      <Field label="Description">
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Agent">
          <Select value={assigneeId} onValueChange={(value) => setAssigneeId(String(value ?? ""))}>
            <SelectTrigger aria-label="Agent">
              <SelectValue>
                {assigneeId ? agentName(overview.agents, assigneeId) : "Any idle agent"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="">Any idle agent</SelectItem>
              {overview.agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
        <Field label="Goal">
          <Select value={goalId} onValueChange={(value) => setGoalId(String(value ?? ""))}>
            <SelectTrigger aria-label="Goal">
              <SelectValue>
                {overview.goals.find((goal) => goal.id === goalId)?.title ?? "None"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="">None</SelectItem>
              {overview.goals.map((goal) => (
                <SelectItem key={goal.id} value={goal.id}>
                  {goal.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onValueChange={(value) => setPriority(String(value ?? "3"))}>
            <SelectTrigger aria-label="Priority">
              <SelectValue>P{priority}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {["1", "2", "3", "4"].map((value) => (
                <SelectItem key={value} value={value}>
                  P{value}
                  {value === "1" ? " (highest)" : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      </div>
      {assigneeId === "" ? (
        <p className="text-muted-foreground text-xs">
          Unassigned tasks go to whichever agent ORCH picks, which uses its provider subscription.
        </p>
      ) : null}
    </FormDialog>
  );
}

export function AgentsSection({ target, overview }: SectionProps) {
  const [creating, setCreating] = useState(false);
  const remove = useOrchestryCommand(orchestryEnvironment.removeAgent, "Remove agent");
  const [busy, run] = useBusy();
  return (
    <Section
      title="Agents"
      action={
        <Button size="sm" disabled={!target.canOperate} onClick={() => setCreating(true)}>
          New agent
        </Button>
      }
    >
      {overview.agents.length === 0 ? (
        <EmptySection
          title="No agents"
          description="Add agents for the roles this project needs."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Current task</TableHead>
              <TableHead>Done / failed</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell>
                  <div className="font-medium">{agent.name}</div>
                  {agent.role !== null ? (
                    <div className="line-clamp-1 max-w-72 text-muted-foreground text-xs">
                      {agent.role}
                    </div>
                  ) : null}
                  {agent.lastError !== null ? (
                    <div className="text-destructive-foreground text-xs">{agent.lastError}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {agent.adapter}
                  {agent.model !== null ? (
                    <span className="text-muted-foreground"> · {agent.model}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <StatusBadge status={agent.status} />
                </TableCell>
                <TableCell>
                  <span className="block max-w-48 truncate">
                    {overview.tasks.find((task) => task.id === agent.currentTaskId)?.title ??
                      "None"}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="tabular-nums">
                    {agent.tasksCompleted} / {agent.tasksFailed}
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !target.canOperate || agent.status === "running"}
                    onClick={async () => {
                      if (!(await confirm(`Remove agent "${agent.name}"?`, true))) return;
                      await run(() =>
                        remove({
                          environmentId: target.environmentId,
                          input: { projectId: target.projectId, agentId: agent.id },
                        }),
                      );
                    }}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {creating ? <CreateAgentDialog target={target} onClose={() => setCreating(false)} /> : null}
    </Section>
  );
}

function CreateAgentDialog({
  target,
  onClose,
}: {
  readonly target: OrchestryTarget;
  readonly onClose: () => void;
}) {
  const create = useOrchestryCommand(orchestryEnvironment.createAgent, "Create agent");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("");
  const [adapter, setAdapter] = useState<OrchestryAgentAdapter>("claude");
  return (
    <FormDialog
      title="New agent"
      submitLabel="Create agent"
      canSubmit={
        name.trim().length > 0 && !name.trim().startsWith("-") && !model.trim().startsWith("-")
      }
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          environmentId: target.environmentId,
          input: {
            projectId: target.projectId,
            name: name.trim(),
            adapter,
            ...(role.trim() ? { role } : {}),
            ...(model.trim() ? { model: model.trim() } : {}),
          },
        });
        return result._tag === "Success";
      }}
    >
      <Field label="Name">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Backend engineer"
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Provider">
          <Select
            value={adapter}
            onValueChange={(value) => setAdapter(value as OrchestryAgentAdapter)}
          >
            <SelectTrigger aria-label="Provider">
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
        </Field>
        <Field label="Model (optional)">
          <Input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Provider default"
          />
        </Field>
      </div>
      <Field label="Role">
        <Textarea
          value={role}
          onChange={(event) => setRole(event.target.value)}
          rows={4}
          placeholder="Owns the API layer. Writes tests for every endpoint and commits its work."
        />
      </Field>
    </FormDialog>
  );
}

export function TeamsSection({ target, overview }: SectionProps) {
  const [creating, setCreating] = useState(false);
  const disband = useOrchestryCommand(orchestryEnvironment.disbandTeam, "Disband team");
  const [busy, run] = useBusy();
  const teams = overview.teams.filter((team) => team.status !== "disbanded");
  return (
    <Section
      title="Teams"
      action={
        <Button
          size="sm"
          disabled={!target.canOperate || overview.agents.length === 0}
          onClick={() => setCreating(true)}
        >
          New team
        </Button>
      }
    >
      {teams.length === 0 ? (
        <EmptySection
          title="No teams"
          description={
            overview.agents.length === 0
              ? "Add agents first, then group them into teams."
              : "Group agents into a team with a lead."
          }
        />
      ) : (
        teams.map((team) => (
          <div key={team.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{team.name}</span>
                <StatusBadge status={team.status} />
              </div>
              {team.description !== null ? (
                <p className="text-muted-foreground text-sm">{team.description}</p>
              ) : null}
              <p className="mt-1 text-muted-foreground text-xs">
                Lead {agentName(overview.agents, team.leadAgentId)} · members{" "}
                {team.memberAgentIds.map((id) => agentName(overview.agents, id)).join(", ")} ·{" "}
                {team.taskIds.length} tasks
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !target.canOperate}
              onClick={async () => {
                if (!(await confirm(`Disband team "${team.name}"? Its agents stay.`, true))) return;
                await run(() =>
                  disband({
                    environmentId: target.environmentId,
                    input: { projectId: target.projectId, teamId: team.id },
                  }),
                );
              }}
            >
              Disband
            </Button>
          </div>
        ))
      )}
      {creating ? (
        <CreateTeamDialog target={target} overview={overview} onClose={() => setCreating(false)} />
      ) : null}
    </Section>
  );
}

function CreateTeamDialog({
  target,
  overview,
  onClose,
}: SectionProps & { readonly onClose: () => void }) {
  const create = useOrchestryCommand(orchestryEnvironment.createTeam, "Create team");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<ReadonlyArray<string>>([]);
  return (
    <FormDialog
      title="New team"
      submitLabel="Create team"
      canSubmit={name.trim().length > 0 && !name.trim().startsWith("-") && members.length > 0}
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          environmentId: target.environmentId,
          input: {
            projectId: target.projectId,
            name: name.trim(),
            memberAgentIds: members,
            ...(description.trim() ? { description } : {}),
          },
        });
        return result._tag === "Success";
      }}
    >
      <Field label="Name">
        <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </Field>
      <Field label="Description">
        <Input value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-sm">Members (the first one picked leads)</legend>
        {overview.agents.map((agent) => (
          <label key={agent.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={members.includes(agent.id)}
              onCheckedChange={(checked) =>
                setMembers((current) =>
                  checked ? [...current, agent.id] : current.filter((id) => id !== agent.id),
                )
              }
            />
            {agent.name}
          </label>
        ))}
      </fieldset>
    </FormDialog>
  );
}

const GOAL_STATUSES: ReadonlyArray<OrchestryGoalStatus> = [
  "active",
  "paused",
  "achieved",
  "abandoned",
];

export function GoalsSection({ target, overview }: SectionProps) {
  const [creating, setCreating] = useState(false);
  const setStatus = useOrchestryCommand(orchestryEnvironment.setGoalStatus, "Update goal");
  const [busy, run] = useBusy();
  return (
    <Section
      title="Goals"
      action={
        <Button size="sm" disabled={!target.canOperate} onClick={() => setCreating(true)}>
          New goal
        </Button>
      }
    >
      {overview.goals.length === 0 ? (
        <EmptySection title="No goals" description="Goals group tasks toward an outcome." />
      ) : (
        overview.goals.map((goal) => {
          const progress = orchestryGoalProgress(goal, overview.tasks);
          return (
            <div key={goal.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{goal.title}</div>
                {goal.description ? (
                  <p className="text-muted-foreground text-sm">{goal.description}</p>
                ) : null}
                <p className="mt-1 text-muted-foreground text-xs">
                  {progress === null
                    ? "No tasks yet"
                    : `${progress.done} of ${progress.total} tasks done`}
                </p>
              </div>
              <Select
                value={goal.status}
                disabled={busy || !target.canOperate}
                onValueChange={(value) =>
                  void run(() =>
                    setStatus({
                      environmentId: target.environmentId,
                      input: {
                        projectId: target.projectId,
                        goalId: goal.id,
                        status: value as OrchestryGoalStatus,
                      },
                    }),
                  )
                }
              >
                <SelectTrigger aria-label={`Status of ${goal.title}`} size="sm" className="w-32">
                  <SelectValue>{humanizeStatus(goal.status)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {GOAL_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {humanizeStatus(status)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          );
        })
      )}
      {creating ? <CreateGoalDialog target={target} onClose={() => setCreating(false)} /> : null}
    </Section>
  );
}

function CreateGoalDialog({
  target,
  onClose,
}: {
  readonly target: OrchestryTarget;
  readonly onClose: () => void;
}) {
  const create = useOrchestryCommand(orchestryEnvironment.createGoal, "Create goal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  return (
    <FormDialog
      title="New goal"
      submitLabel="Create goal"
      canSubmit={title.trim().length > 0 && !title.trim().startsWith("-")}
      onClose={onClose}
      onSubmit={async () => {
        const result = await create({
          environmentId: target.environmentId,
          input: {
            projectId: target.projectId,
            title: title.trim(),
            ...(description.trim() ? { description } : {}),
          },
        });
        return result._tag === "Success";
      }}
    >
      <Field label="Title">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </Field>
      <Field label="Description">
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
        />
      </Field>
    </FormDialog>
  );
}

export function RunsSection({ target, overview }: SectionProps) {
  const result = useAtomValue(
    orchestryEnvironment.runs({
      environmentId: target.environmentId,
      input: { projectId: target.projectId },
    }),
  );
  if (AsyncResult.isFailure(result)) {
    return (
      <Alert variant="error">
        <AlertDescription>{orchestryErrorMessage(Cause.squash(result.cause))}</AlertDescription>
      </Alert>
    );
  }
  if (!AsyncResult.isSuccess(result)) return <Skeleton className="h-32 w-full" />;
  const runs = result.value;
  return (
    <Section title="Runs in the last 30 days">
      {runs.length === 0 ? (
        <EmptySection title="No runs" description="Runs appear when ORCH starts work on a task." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Tokens</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((runRecord) => (
              <TableRow key={runRecord.id}>
                <TableCell className="max-w-56">
                  <div className="truncate">
                    {overview.tasks.find((task) => task.id === runRecord.taskId)?.title ??
                      runRecord.taskId}
                  </div>
                  {runRecord.error !== null ? (
                    <div className="line-clamp-2 text-destructive-foreground text-xs">
                      {runRecord.error}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{agentName(overview.agents, runRecord.agentId)}</TableCell>
                <TableCell>
                  <StatusBadge status={runRecord.status} />
                  {runRecord.attempt > 1 ? (
                    <span className="ms-1 text-muted-foreground text-xs">
                      attempt {runRecord.attempt}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {new Date(runRecord.startedAt).toLocaleString()}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="tabular-nums">{runRecord.tokensTotal ?? "Unknown"}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function ActivityList({
  target,
  limit,
}: {
  readonly target: OrchestryTarget;
  readonly limit?: number;
}) {
  const result = useAtomValue(
    orchestryEnvironment.events({
      environmentId: target.environmentId,
      input: { projectId: target.projectId },
    }),
  );
  if (AsyncResult.isFailure(result)) {
    return (
      <Alert variant="error">
        <AlertDescription>{orchestryErrorMessage(Cause.squash(result.cause))}</AlertDescription>
      </Alert>
    );
  }
  const events = AsyncResult.isSuccess(result)
    ? result.value.filter((event) => event.event !== "orchestrator:tick").toReversed()
    : [];
  const shown = limit === undefined ? events : events.slice(0, limit);
  if (shown.length === 0) {
    return (
      <EmptySection
        title="No activity yet"
        description="ORCH events from this server appear here while the runtime runs."
      />
    );
  }
  return (
    <ol className="flex flex-col divide-y rounded-lg border">
      {shown.map((event) => (
        <li key={event.sequence} className="flex items-baseline gap-3 px-3 py-2 text-sm">
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {new Date(event.ts).toLocaleTimeString()}
          </span>
          <span className={event.level === "error" ? "text-destructive-foreground" : undefined}>
            {describeOrchestryEvent(event)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ActivitySection({ target }: { readonly target: OrchestryTarget }) {
  return (
    <Section title="Activity">
      <ActivityList target={target} />
    </Section>
  );
}

export function ReviewSection({ target, overview }: SectionProps) {
  const sync = useOrchestryCommand(orchestryEnvironment.syncIntegration, "Sync integration branch");
  const merge = useOrchestryCommand(orchestryEnvironment.mergeIntegration, "Merge ORCH work");
  const disable = useOrchestryCommand(orchestryEnvironment.disable, "Disable Orchestry");
  const [showDiff, setShowDiff] = useState(false);
  const [busy, run] = useBusy();
  const integration = overview.integration;
  if (integration === null) return null;
  const input = { projectId: target.projectId };
  const env = { environmentId: target.environmentId };
  const stopped = overview.status.state === "stopped" || overview.status.state === "failed";
  const mergeBlocked =
    integration.userBranch === null
      ? "Your checkout is not on a branch."
      : integration.userCheckoutDirty
        ? "Commit or stash your local changes first."
        : integration.ahead === 0
          ? "Nothing new to merge."
          : null;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Integration branch">
        <p className="text-muted-foreground text-sm">
          <code>{integration.branch}</code> has {integration.ahead} commit
          {integration.ahead === 1 ? "" : "s"} your branch{" "}
          {integration.userBranch !== null ? (
            <code>{integration.userBranch}</code>
          ) : (
            "(detached HEAD)"
          )}{" "}
          lacks, and is {integration.behind} behind it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !target.canOperate || mergeBlocked !== null}
            onClick={async () => {
              const ok = await confirm(
                `Merge ${integration.ahead} ORCH commit${integration.ahead === 1 ? "" : "s"} from ${integration.branch} into ${integration.userBranch}?\nThis writes to your checkout. A conflict aborts the merge and leaves it unchanged.`,
              );
              if (ok) await run(() => merge({ ...env, input }));
            }}
          >
            Merge into {integration.userBranch ?? "branch"}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !target.canOperate || !stopped || integration.behind === 0}
            onClick={() => void run(() => sync({ ...env, input }))}
          >
            Bring {integration.userBranch ?? "branch"} into ORCH
          </Button>
          <Button
            variant="ghost"
            disabled={integration.files.length === 0}
            onClick={() => setShowDiff((value) => !value)}
          >
            {showDiff ? "Hide diff" : "Show diff"}
          </Button>
        </div>
        {mergeBlocked !== null && integration.ahead > 0 ? (
          <p className="text-muted-foreground text-xs">{mergeBlocked}</p>
        ) : null}
        {!stopped && integration.behind > 0 ? (
          <p className="text-muted-foreground text-xs">Stop ORCH to bring your branch in.</p>
        ) : null}
      </Section>
      <Section title={`Changed files · ${integration.files.length}`}>
        {integration.files.length === 0 ? (
          <EmptySection
            title="Nothing to merge"
            description="Your branch already has all of ORCH's work."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="text-end">Added</TableHead>
                <TableHead className="text-end">Removed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {integration.files.map((file) => (
                <TableRow key={file.path}>
                  <TableCell>
                    <span className="font-mono text-xs">{file.path}</span>
                  </TableCell>
                  <TableCell className="text-end">
                    <span className="text-success-foreground tabular-nums">
                      {file.additions === null ? "bin" : `+${file.additions}`}
                    </span>
                  </TableCell>
                  <TableCell className="text-end">
                    <span className="text-destructive-foreground tabular-nums">
                      {file.deletions === null ? "bin" : `-${file.deletions}`}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {showDiff && integration.files.length > 0 ? (
          // A new key remounts the query whenever the branch moves, so a merge never leaves a stale patch.
          <IntegrationDiff
            key={`${integration.ahead}:${integration.behind}:${integration.files.length}`}
            target={target}
          />
        ) : null}
      </Section>
      <Section title="Turn off">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-muted-foreground text-sm">
            Stops ORCH and removes its worktree and state. The integration branch and its commits
            stay in your repository.
          </p>
          <Button
            variant="destructive-outline"
            disabled={busy || !target.canOperate}
            onClick={async () => {
              const ok = await confirm(
                "Turn off Orchestry for this project?\nORCH's agents, tasks, goals and history are deleted. The integration branch stays.",
                true,
              );
              if (ok) await run(() => disable({ ...env, input }));
            }}
          >
            Turn off Orchestry
          </Button>
        </div>
      </Section>
    </div>
  );
}

function IntegrationDiff({ target }: { readonly target: OrchestryTarget }) {
  const result = useAtomValue(
    orchestryEnvironment.integrationDiff({
      environmentId: target.environmentId,
      input: { projectId: target.projectId },
    }),
  );
  if (AsyncResult.isFailure(result)) {
    return (
      <Alert variant="error">
        <AlertTitle>Could not load the diff</AlertTitle>
        <AlertDescription>{orchestryErrorMessage(Cause.squash(result.cause))}</AlertDescription>
      </Alert>
    );
  }
  if (!AsyncResult.isSuccess(result)) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="flex flex-col gap-2">
      {result.value.truncated ? (
        <p className="text-muted-foreground text-xs">The diff is large; only its start is shown.</p>
      ) : null}
      <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">
        {result.value.patch}
      </pre>
    </div>
  );
}
