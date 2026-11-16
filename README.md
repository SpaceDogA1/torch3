<p align="center">
  <img src="./assets/torch3-mark.svg" width="80" height="80" alt="Torch3 logo" />
</p>

<h1 align="center">Torch3</h1>

<p align="center">A fork of <a href="https://github.com/pingdotgg/t3code">T3 Code</a> with multi-agent orchestration built in.</p>

<p align="center">
  <a href="./docs/user/orchestry.md"><strong>Orchestry guide</strong></a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="./docs/operations/development.md">Development</a>
</p>

Torch3 is T3 Code, the open-source control plane for coding agents, plus **Orchestry**: a native
integration of [ORCH](https://github.com/oxgeneral/ORCH) that lets a team of agents work on a project
in parallel. T3 stays the interface, auth, transport, and owner of your checkout. ORCH runs the
agents, tasks, goals, and teams.

It works with the same agents as T3 Code: Claude Code, Codex, Cursor, OpenCode, Grok Build,
Antigravity, Kiro, Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent. It drives
the subscriptions you are already signed in to.

## Orchestry

- **Per-project teams.** Turn Orchestry on for a project, add agents, and queue tasks. Each agent
  works in its own Git worktree.
- **Your checkout stays yours.** ORCH merges into a separate `t3-orchestry/<project>` integration
  branch. You review the diff and merge it into your branch yourself.
- **Where you work.** Open Orchestry from the sidebar, the command palette, or a project's
  right-click menu. Send `/orch <task>` from any thread to queue work for the team.
- **Safe by default.** ORCH runs in worktree mode only, never updates itself, and never runs its
  install script. Projects that cannot run ORCH say why before you enable it.
- **Reachable by agents.** Orchestry's reads and actions are exposed as `orchestry_` MCP tools.

Read the [Orchestry guide](./docs/user/orchestry.md) to get started, and the
[integration notes](./docs/internals/orchestry.md) for how it is built.

## Run it

Torch3 has no published installers or mobile builds yet. Run it from source:

```sh
vp i
vp run dev
```

`vp` comes from [Vite+](https://viteplus.dev/guide/) and provides the pinned Node version. Open the
pairing URL the dev runner prints. The [development runbook](./docs/operations/development.md) covers
the rest, including desktop artifact builds.

To use a project with Orchestry, it must be the root of its own Git repository with at least one
commit. ORCH agents need one agent CLI installed and signed in, for example `claude auth login` for
Claude Code or `codex login` for Codex.

## Status

| Area                         | State                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| Web and dev server           | Working, with the Torch3 name and flame mark                            |
| Orchestry (server, web, MCP) | Working and tested                                                      |
| Desktop app                  | Installer not built yet; its name and macOS/Windows icons are T3 Code's |
| Mobile app                   | T3 Code's app; no Orchestry views yet                                   |
| CI                           | Runs on GitHub-hosted runners                                           |
| Releases                     | Not set up: signing, Expo, and Cloudflare credentials are missing       |

## Credits

Torch3 is built on [T3 Code](https://t3.codes) by the T3 team and
[ORCH](https://github.com/oxgeneral/ORCH) by oxgeneral. Created in [T3 Code](https://t3.codes).

## License

[MIT](./LICENSE)
