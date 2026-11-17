<img src="assets/icon.svg" width="64" height="64" alt="">

# Torch3 fork notes

Torch3 is a fork of [T3 Code](https://github.com/pingdotgg/t3code) that integrates
[ORCH](https://github.com/oxgeneral/ORCH) as **Orchestry**, a background multi-agent orchestration
engine. T3 Code remains the application: interface, auth, transport and the user's checkout. ORCH
owns teams of agents, tasks, goals and its own state.

These notes are for maintainers. Users start at the [README](README.md); contributors at
[CONTRIBUTING.md](CONTRIBUTING.md); agents and maintainers follow the
[Torch3 rules](AGENTS.md#torch3-rules).

## What differs from upstream

| Area               | Upstream T3 Code                          | Torch3                                                             |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| Orchestration      | none                                      | Orchestry (project menu, `/orch`, MCP tools)                       |
| Data folder        | `~/.t3`                                   | `~/.torch3` (`T3CODE_HOME` still overrides)                        |
| Desktop identity   | `com.t3tools.t3code`, profile `t3code-v2` | `dev.torch3.app`, profile `torch3`, no `t3code://` OS registration |
| Background service | `t3code` / `com.t3tools.t3code.service`   | `torch3` / `dev.torch3.service`                                    |
| npm package        | `t3` (downloads a single-file executable) | `torch3` (runs on the host Node, so ORCH works)                    |
| Releases           | `release.yml` (upstream repository only)  | `torch3-release.yml`: unsigned installers and npm                  |
| CI runners         | Blacksmith                                | GitHub-hosted                                                      |
| Docs               | T3 Code                                   | Torch3, with notes where an upstream service is not included       |

Internal names stay upstream's on purpose: `T3CODE_*` variables, `@t3tools/*` packages, `t3_*` MCP
tools, the in-app `t3code://` scheme and worktree-local `.t3` folders. Renaming them would turn every
upstream merge into a conflict.

## Known gaps

These still behave as upstream does and need Torch3-specific work:

- `torch3 update`, `install`, `uninstall` and `service`, and the in-app server update, follow
  upstream's `t3` release feed (`apps/server/src/cli/update.ts`, `apps/server/src/cloud/npmRelease.ts`).
- Triage files issues on `pingdotgg/t3code` (`apps/server/src/triage/triagePrompt.ts`).
- Product usage events go to upstream's endpoint (`apps/server/src/telemetry/AnalyticsService.ts`).
- The desktop app's **Install** command in **Settings → About** installs a `t3` launcher.
- The mobile app is not rebranded or published.
- Text the models read (provider instructions, MCP tool descriptions) and some server messages
  outside the CLI still say "T3 Code".

## Remotes

- `upstream`: https://github.com/pingdotgg/t3code.git (fetched blob-less; `.repos/` excluded by
  sparse checkout, as upstream's AGENTS.md allows)
- `orch-upstream`: https://github.com/oxgeneral/ORCH.git

The pre-fork repository state is preserved at tag `backup/pre-fork-4128497`.

## Syncing with upstream

```sh
git fetch upstream main
git switch -c sync/upstream-$(date +%Y%m%d) main
git merge upstream/main
```

Resolve conflicts with these defaults:

- **Torch3-only paths** (listed in rule 3 of the [Torch3 rules](AGENTS.md#torch3-rules)): keep ours.
- **`README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `TORCH3.md`, `.github/ISSUE_TEMPLATE/`**: keep ours,
  then read upstream's change and port anything that still applies.
- **`docs/`**: take upstream's text, then reapply the Torch3 names (`Torch3`, `torch3`, `~/.torch3`)
  and keep the Torch3 notes on upstream-only pages.
- **Identity files** (`DesktopUserData.ts`, `DesktopEnvironment.ts`, `bootService.ts`, `os-jank.ts`,
  `scripts/build-desktop-artifact.ts`, `scripts/dev-runner.ts`): take upstream's logic, keep Torch3's
  names and paths.
- **Product name in client and CLI text**: take upstream's side, then run
  `vp run torch3:rebrand`, which renames "T3 Code" to "Torch3" in the web, desktop,
  CLI and client-runtime sources and their tests.
- **`.github/workflows/`**: take upstream's change, then map Blacksmith runner labels back to
  GitHub-hosted ones (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-latest`, `windows-2025`).

After the merge, run `vp i`, then `vp run check:changed`, and open the merge as a PR so CI runs on
GitHub-hosted runners before it lands on `main`.

## Releasing

Run the **Torch3 release** workflow with a version, or push a `vX.Y.Z` tag. It builds unsigned
macOS, Windows and Linux installers, packs `torch3` for npm, creates the GitHub Release, and
publishes to npm when the `NPM_TOKEN` secret is set.
