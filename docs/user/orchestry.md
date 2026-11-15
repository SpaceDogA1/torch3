# Orchestry

Orchestry runs [ORCH](https://github.com/oxgeneral/ORCH) on a project: teams of agents that take
tasks, work in parallel in their own Git worktrees, and merge their results. ORCH's agents work on a
separate **integration branch**. Nothing reaches your checkout until you merge it yourself.

Open **Orchestry** from the sidebar or the command palette.

## Turn it on for a project

Pick the project, choose a default provider, and select **Enable Orchestry**. The project must be the
root of its own Git repository with at least one commit; a folder inside another repository is
refused.

Enabling creates a branch named `t3-orchestry/<project id>` and a worktree for it in your T3 Code data
folder. Its first commit adds `.orchestry` to `.gitignore`. ORCH also creates a default
**Agent Creator** agent on the provider you chose.

## Run work

1. Under **Agents**, add the agents you need. Each has a provider, an optional model, and a role:
   its standing instructions.
2. Under **Tasks**, create tasks and assign them to agents. Optionally group them under a goal
   (**Goals**) or put agents in a team (**Teams**).
3. Select **Start**. ORCH runs every `todo` task with its agent and retries failures.

ORCH gives unassigned tasks to any idle agent, including Agent Creator. Every run uses that agent's
provider subscription, so remove agents you do not want working and assign tasks explicitly.

Agents must commit their work. ORCH deletes a task's worktree after merging it, and anything an
agent left uncommitted is lost.

**Activity** shows ORCH's events while the runtime runs on this server. **Runs** lists the last 30
days of agent runs from ORCH's own history.

## Review and merge

**Review** compares the integration branch with the branch your checkout is on: the commits it adds,
the changed files, and the full diff. **Merge into** _your branch_ merges it after you confirm. It
writes to your checkout, so it is refused while you have uncommitted changes, and a conflict aborts
the merge and leaves your checkout as it was.

If your branch moved on, stop ORCH and select **Bring** _your branch_ **into ORCH** so agents work on
current code and the next merge applies cleanly.

Tasks that land in review (a merge conflict, or an agent set to ask for approval) show **Approve**
and **Reject** on **Tasks**. Rejecting sends the task back with your notes.

## Turn it off

**Review → Turn off Orchestry** stops ORCH and deletes its worktree, agents, tasks, goals and history.
The integration branch and its commits stay in your repository.

## Troubleshooting

- **"Running outside T3"**: an ORCH process this server did not start holds the project's lock, for
  example one you ran with `orch serve` in a terminal. Stop it there; T3 Code never stops it for you.
- **"ORCH stopped unexpectedly"**: the runtime exited on its own. The message shows ORCH's last
  output. Select **Start** to run it again; unfinished tasks are retried.
- **Enabling fails with "not its root"**: open the repository's root folder as the project instead
  of a subfolder.
- **Merge refused**: commit or stash your changes, or switch your checkout to a branch, then merge
  again.
- **The single-file `t3` executable** cannot run ORCH. Use the desktop app or `npx t3`.
