# FAQ

## What is Torch3?

Torch3 is a fork of [T3 Code](https://github.com/pingdotgg/t3code) with
[ORCH](https://github.com/oxgeneral/ORCH) multi-agent orchestration built in as
[Orchestry](./orchestry.md). Everything T3 Code does, such as threads, worktrees, checkpoints, diffs
and remote access, works the same. Orchestry adds a way to hand one goal to a team of agents
that plan, build and review it on their own branch.

## How is it different from T3 Code?

- **Orchestry.** Enable it per project from the sidebar's project menu, then queue work with
  `/orch` in the composer. [Orchestry](./orchestry.md)
- **Its own data.** Torch3 keeps everything in `~/.torch3` and uses its own app ID, so it runs
  beside an installed T3 Code without sharing threads, settings or sign-ins.
- **Its own releases.** Install with `npx @torch3/cli` or the installers on the
  [Torch3 releases](https://github.com/SpaceDogA1/torch3/releases) page. [Install](./install.md)
- **No hosted services.** T3 Connect, app.t3.codes and the T3 mobile apps belong to upstream
  T3 Code and do not work with Torch3. Use the local network or Tailscale for remote access.

## Is Torch3 a harness?

No. A harness turns a model into an agent: it gives the model tools, runs them and hands the
results back. Claude Code, Codex and the other providers are harnesses. Torch3 drives them, so you
need at least one installed and signed in. [Provider setup](./install.md#providers)

## Can I use my Claude or ChatGPT subscription?

Yes. Torch3 runs the provider CLIs you already have, with the accounts they are signed in to. You
pay your provider as you do today. Torch3 itself is free and open source (MIT).

## Does my code go to Torch3's servers?

There are no Torch3 servers. Your code and prompts go from your machine to your provider. The
server does send product usage events, without prompts or file contents, to upstream T3 Code's
endpoint. Set `T3CODE_TELEMETRY_ENABLED=false` to turn them off. [Product usage data](./telemetry.md)

## How do I use Torch3 from another device?

Agents run on the machine that runs the Torch3 server. Reach it from another computer or a phone's
browser over your local network or Tailscale, and pair with `torch3 pair`.
[Remote access](./remote-access.md)

## Does it work on Windows, Mac, and Linux?

Yes. There are desktop installers for macOS (Apple silicon), Windows (x64) and Linux (x64
AppImage and `.deb`), and `npx @torch3/cli` runs anywhere Node.js 22.16 or newer does. [Install](./install.md)

## Why does Orchestry refuse my project?

Orchestry needs the project folder to be the root of its own Git repository with at least one
commit, so ORCH's worktree never touches a parent repository. The project menu shows the reason
before you enable it. [Orchestry](./orchestry.md#troubleshooting)

## Will Orchestry change my branch?

No. ORCH works on its own `t3-orchestry/<project id>` branch in a separate worktree. Nothing is
merged into your branch until you merge it yourself.

## Can I add several accounts for one provider?

Yes. Add another provider instance in **Settings → Providers** with its own environment. Setup
for two: [Codex](./providers-codex.md#use-multiple-accounts) ·
[Claude](./providers-claude.md#separate-accounts-or-configurations).

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance and give it its own keys and endpoint.
[OpenRouter](./providers-claude.md#openrouter) · [Provider instances](./install.md#providers)

## Worktrees are eating my disk. How do I clean them up?

Open **Settings → Worktrees → Cleanup** and turn on automatic worktree cleanup, or run it now from
there. [Storage cleanup](./project-settings.md#storage-cleanup)

## Why is my provider not showing up?

Usually the CLI is not installed, or not on the `PATH` of the machine that runs the server. Sign in
on that machine first, such as `codex login` or `claude auth login`. Still missing? Set its
**Binary path** in provider settings. [Provider setup](./install.md#providers)

## Where do I report a bug?

Open an issue on [SpaceDogA1/torch3](https://github.com/SpaceDogA1/torch3/issues). Bugs that also
happen in T3 Code belong upstream.
