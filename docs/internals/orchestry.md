# Orchestry (ORCH) integration

[ORCH](https://github.com/oxgeneral/ORCH) (`@oxgeneral/orch`, CLI `orch`) is a multi-agent
orchestrator with its own agents, tasks, goals, teams and file-based state under `.orchestry/`.
Torch3 runs it as a supervised background process per T3 project. T3 owns the UI, auth,
transport and the user's checkout; ORCH owns its orchestration lifecycle and state. It is a
separate system from T3's own orchestration (`orchestration-v2`), and the two share nothing
but the repository.

Code: [`apps/server/src/orchestry/`](../../apps/server/src/orchestry/). Wire types:
[`packages/contracts/src/orchestry.ts`](../../packages/contracts/src/orchestry.ts).

## ORCH never runs in the user's checkout

After every successful agent run, ORCH runs `git merge --no-ff <task branch>` into whatever
branch its project root has checked out, before review and whatever the approval policy
(`orchestrator.ts`, `_handleRunSuccess`). `orch task approve` only flips a status afterwards.

So each project gets an **integration worktree** of its own repository, on branch
`t3-orchestry/<project>`, at `<T3 home>/orchestry/<project>/workspace`. ORCH's project root,
`.orchestry/` state, task worktrees and merges all live there. The user's checkout is only read.
Bringing the integration branch into the user's branch is a separate, explicit T3 operation.

- The branch namespace is `t3-orchestry/`, not `orchestry/`: ORCH names task branches
  `orchestry/<task>/<slug>`, and Git cannot hold both `orchestry/x` and `orchestry/x/...`.
- The directory is outside T3's `worktrees/` so T3's managed-worktree cleanup never treats it
  as its own.
- Every agent, and every unfinished task, must use `workspace_mode: worktree`. Runtime start
  rejects anything else ([`findIsolationViolations`](../../apps/server/src/orchestry/OrchestryWorkspace.ts)).

`orch init` runs `git init` in a non-repository, `git add -A && git commit` in a repository
without commits, and silently falls back to `shared` mode without Git. Inside an enclosing
repository (a home directory under Git, say) it uses that repository. T3 therefore refuses a
project folder that is not the root of its own Git repository with at least one commit, before
ORCH's init can run.

ORCH never commits for an agent; its agent prompts tell agents to commit. After a "successful"
merge it removes the task worktree with `git worktree remove --force`, so work an agent left
uncommitted is deleted. A `shell` agent must commit its own changes.

## Process supervision

ORCH is started as `<node> --import <stop preload> <@oxgeneral/orch>/dist/cli.js serve
--log-format json` with an argument array, from `HostProcess.ExecutablePath` with
`ELECTRON_RUN_AS_NODE=1` so the desktop's Electron binary behaves as Node. The single-file
`t3` executable has no Node to run ORCH's files and reports an unsupported host.

ORCH shuts down gracefully (cancels its agents' runs, releases its lock) only from its
SIGINT/SIGTERM handler, and Windows cannot deliver those to a child: `kill` is
`TerminateProcess`. The preload ([`STOP_BOOTSTRAP`](../../apps/server/src/orchestry/OrchestryRuntime.ts))
turns a `stop` line on stdin, or stdin closing, into an in-process SIGTERM. stdin also closes
when the T3 server dies, so ORCH stops itself rather than running orphaned.

ORCH's lock (`.orchestry/orchestry.lock`, holding a PID, touched every tick, stale after 60s)
prevents a second orchestrator. T3 reports a live lock it did not create as `external` and
neither starts beside it nor signals it.

`agent:error` is logged for any agent stderr, including warnings from runs that succeed. A run's
outcome is `agent:completed`'s `success` field.

## Dependency safety

- **No self-update.** Upstream ORCH runs `npm install -g @oxgeneral/orch@<latest>` after every
  one-shot command and from `orch serve`, and writes `~/.orchestry/update-check.json`.
  [`patches/@oxgeneral__orch@1.0.34.patch`](../../patches/@oxgeneral__orch@1.0.34.patch)
  replaces the bundled `update-check` module with no-ops. ORCH updates ship as a dependency
  bump here. On a bump, the chunk hash in that file name changes: regenerate the patch and
  check that `cli.js` and `serve-*.js` still import update logic only from it.
- **No install script.** ORCH's `postinstall` rewrites files in `node_modules/ink` and installs
  a Claude Code skill into the user's home directory. `allowBuilds` keeps it disabled.

## Packaging

ORCH ships as `@oxgeneral/orch` in `apps/server` dependencies and is run, never imported, so the
server bundle never sees it. Release stages (desktop sidecar, CLI and WSL runtime archives) install it
through `CLI_SIDE_PROCESS_PACKAGES` in
[`cli-external-packages.ts`](../../scripts/lib/cli-external-packages.ts): pnpm installs its whole
dependency closure, the update-check patch applies, and `allowBuilds` keeps its install script off.
Listing it as a runtime external instead would require every transitive dependency of ORCH to be
external as well.

## Upgrading ORCH

1. Bump the version in `apps/server/package.json` and the `overrides` pin in `pnpm-workspace.yaml`.
2. Re-read ORCH's `cli/update-check.ts`, `bin/cli.ts` and `cli/commands/serve.ts`. Find the bundled
   update-check module in `dist/` (its hash changes per build) and confirm `cli.js` and `serve-*.js`
   still import update logic only from it.
3. Regenerate `patches/@oxgeneral__orch@<version>.patch` and rename its `patchedDependencies` key.
4. Re-check the behaviors this integration depends on: merge-before-review in `orchestrator.ts`,
   `init`'s Git side effects, the lock file format, and the `--json` output of `status`, `goal list`,
   `team list` and `logs`. Run `apps/server/src/orchestry` tests.
