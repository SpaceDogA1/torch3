# Contributing to Torch3

Torch3 is [T3 Code](https://github.com/pingdotgg/t3code) with [ORCH](https://github.com/oxgeneral/ORCH)
multi-agent orchestration built in. It is a small fork with one job: make Orchestry work well while
staying easy to merge with upstream. Contributions that help with that are welcome.

## Where a change belongs

Most of Torch3 is upstream T3 Code. Before you open anything, decide which project owns the problem:

| The problem is in…                                                                     | Send it to                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Orchestry: the project menu, `/orch`, the ORCH runtime, its worktree, branch or merge  | Torch3                                                                   |
| Torch3 identity, releases, the `@torch3/cli` npm package, installers, these docs       | Torch3                                                                   |
| Anything that also happens in T3 Code (threads, providers, terminals, diffs, settings) | [Upstream](https://github.com/pingdotgg/t3code), following its own rules |
| ORCH itself (its agents, task engine or CLI)                                           | [ORCH](https://github.com/oxgeneral/ORCH)                                |

Fixes for upstream bugs reach Torch3 when we merge upstream. A Torch3 PR that patches upstream code
makes every later merge harder, so we take one only when the bug blocks Orchestry and cannot wait.

## Issues and ideas

- **Bugs:** open an [issue](https://github.com/SpaceDogA1/torch3/issues). Include your Torch3 version,
  how you run it (`npx @torch3/cli`, desktop app, or source), your OS, and the steps that show the bug.
  For Orchestry bugs, add the message the project menu shows.
- **Ideas:** open an issue that starts with `Idea:` and describes the problem you hit, not only the
  feature you want. Please wait for a maintainer to agree before you build a feature.
- **Security problems:** do not open a public issue. Report them privately from the repository's
  **Security** tab.

## Rules for a PR

A PR that follows these rules can still be closed, but one that breaks them will be.

<a id="prior-approval"></a>

### Agree on features first

A bug fix needs no prior discussion. A small fix for an obvious bug needs no issue either; for a larger
one, link the issue that shows the bug. A new feature, a UI change or a new dependency needs an issue
a maintainer has agreed to. Link it.

<a id="one-problem"></a>

### One problem per PR

Fix one problem. Include every change that fix needs across contracts, server, clients, tests and
docs. Cleanup, refactors and a second fix go in their own PRs.

### Keep the fork diff small

- Put Torch3-only code where the [Torch3 rules](AGENTS.md#torch3-rules) say it lives, and touch upstream
  files only where a feature needs a hook.
- Keep upstream's internal names (`T3CODE_*` variables, `@t3tools/*` packages, `t3_*` MCP tools).
  Rename only what users see.
- Never make Torch3 read or change T3 Code's data in `~/.t3`.
- Keep ORCH in worktree mode, and never merge agent work into a user's branch automatically.

<a id="verification"></a>

### Show that it works

Say how you found the bug, how you checked the fix, and what you saw. "Tests pass" is not evidence.

- Logic, state and protocol fixes come with a test that fails without the fix.
- UI changes need before and after screenshots; add a short video for motion or timing. Upload them
  to the PR, do not commit them.
- Run `vp run check:changed` before you push.

<a id="models"></a>

### Say who wrote it

Coding agents are welcome. Name the model and harness that wrote the code at the end of the PR
description, and review the diff yourself before you ask us to. You are responsible for every line,
whoever typed it.

### Keep your PR mergeable

Rebase on `main` when your PR conflicts with it. A PR that conflicts for 14 days with no activity is
closed.

<a id="bans"></a>

## Conduct

Be kind and assume good faith. Accounts that spam issues or PRs with automation, or that harass
contributors and maintainers, are blocked.

<a id="closure-and-reconsideration"></a>

## When your PR is closed

We say which rule the PR broke, or why it does not fit Torch3. Fix the problem and comment on the PR,
or open a focused replacement that links the old one.

## Setup

1. Install [Vite+](https://viteplus.dev/guide/) (`vp`), then run `vp i` in the checkout.
2. Run `vp run dev`. In the main checkout, dev data lives in `~/.torch3/dev`, never in your installed
   Torch3's `~/.torch3/userdata` or T3 Code's `~/.t3`.
3. Read [AGENTS.md](AGENTS.md) before your first change. It holds the rules for people and coding
   agents alike.

See the [development runbook](docs/operations/development.md#first-checkout) for everything else,
and [TORCH3.md](TORCH3.md) for how the fork tracks upstream.
