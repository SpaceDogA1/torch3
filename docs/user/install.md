# Install Torch3

Torch3 runs coding agents on your computer and lets you control them from its desktop or web app.
Set up the machine where the agents will work first.

> [!NOTE]
> Torch3 keeps its data in `~/.torch3` and uses its own app ID, so it installs and runs beside
> T3 Code without sharing threads, settings or sign-ins.

## Requirements

- An installed, signed-in provider CLI before you start a thread. You can launch Torch3 and
  configure providers afterwards.
- For the command line: [Node.js](https://nodejs.org) 22.16 or newer.
- For [Orchestry](./orchestry.md): Git, and a project that is its own Git repository.

## Command line

Run Torch3 straight from npm:

```bash
npx torch3
```

This starts the server and opens the web app. To keep the command around, install it globally:

```bash
npm install --global torch3
torch3
```

| Task                                  | Command                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Start the server and open the web app | `torch3`                                                                    |
| Start the server without a browser    | `torch3 serve`                                                              |
| Pair another browser or device        | `torch3 pair` ([details](./remote-access.md))                               |
| Reclaim database space                | `torch3 doctor` ([details](./background-service.md#reclaim-database-space)) |
| Move to the newest release            | `npm install --global torch3@latest`                                        |
| Remove it again                       | `npm uninstall --global torch3`                                             |

Run `torch3 --help` for the full reference. To start in a new working directory, use an explicit
path such as `torch3 ./my-project`. A bare directory name is accepted only if it already exists.

If `torch3` reports an already running server, run the `torch3 pair` command it names and open the
pairing URL to connect to that server. Stop it before starting a replacement, or use a different
`--base-dir` for an independent server.

> [!WARNING]
> `torch3 update`, `torch3 install`, `torch3 uninstall` and `torch3 service` still manage
> upstream T3 Code's standalone `t3` launcher, which cannot run Orchestry. Update and remove the
> npm package with `npm` instead.

### Install from a release file

Each [release](https://github.com/SpaceDogA1/torch3/releases) also carries the npm package as
`torch3-<version>.tgz`. Install it when you need an exact version or have no access to the npm
registry:

```bash
npm install --global ./torch3-<version>.tgz
torch3
```

To try it without installing, run `npx --package ./torch3-<version>.tgz torch3`.

### Run from source

To run the latest code, build it with `vp`, which provides the Node version it needs
([Install vp](../operations/development.md#first-checkout)):

```bash
git clone https://github.com/SpaceDogA1/torch3
cd torch3 && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

Update it with `git pull` and a rebuild.

## Desktop app

Download the installer for your platform from the
[Torch3 releases](https://github.com/SpaceDogA1/torch3/releases):

| Platform              | File                                                          |
| --------------------- | ------------------------------------------------------------- |
| Windows (x64)         | `Torch3-<version>-x64.exe`                                    |
| macOS (Apple silicon) | `Torch3-<version>-arm64.dmg`, or `Torch3-<version>-arm64.zip` |
| Linux (x64)           | `Torch3-x86_64.AppImage`, or `Torch3-<version>-amd64.deb`     |

There are no builds for Intel Macs or Arm Windows and Linux yet.

The installers are not code-signed yet:

- **macOS:** the first time, right-click Torch3 in Applications and choose **Open**, then
  **Open** again.
- **Windows:** run the `.exe`. If SmartScreen appears, choose **More info**, then **Run anyway**.
  It installs for your user only, with no administrator prompt, and adds Torch3 to the Start menu.
- **Linux:** install the `.deb` with `sudo apt install ./Torch3-*-amd64.deb`, or make the AppImage
  executable and run it:

  ```bash
  chmod +x ./Torch3-*.AppImage
  ./Torch3-*.AppImage
  ```

Torch3 is not in Homebrew, winget, Scoop, the AUR or nixpkgs. Those packages install upstream
T3 Code.

### Where the desktop app keeps its data

Threads, projects and settings live in `~/.torch3`, the same folder the `torch3` command uses. The
desktop window's own browser profile lives in a `torch3` folder under the system's app data:
`%APPDATA%	orch3` on Windows, `~/Library/Application Support/torch3` on macOS and
`~/.config/torch3` on Linux. None of these are shared with T3 Code.

### The `torch3` command

The desktop app can add a command-line tool from **Settings → About**. It currently installs
upstream's `t3` launcher name; for a Torch3 command, use `npm install --global torch3`.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Sharing & access** to run agents and projects
there. Install the provider CLIs inside that distro. Torch3 installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
torch3 app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `torch3 app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

### Drop a folder on the sidebar

Drag one or more folders from Finder, Explorer, or your file manager onto the
sidebar. Each one opens as a project on this computer, the same as `torch3 app`.
Files dropped on a thread still attach to that thread. Browsers do not share
folder paths, so in the web app use **Add project** instead.

### Uninstall the desktop app

- **Windows:** **Settings → Apps → Installed apps → Torch3 → Uninstall**.
- **macOS:** quit Torch3 and move it from Applications to the Bin.
- **Linux:** `sudo apt remove torch3` for the `.deb`, or delete the AppImage.

Uninstalling keeps your threads and settings. To remove them too, delete `~/.torch3` and the
desktop profile folder listed above. Do not delete `~/.t3`: that is T3 Code's data.

## Mobile app

There is no Torch3 mobile app yet. A phone can use the web app over your local network or
Tailscale; see [remote access](./remote-access.md).

If the desktop app crashes during launch, open Settings → Diagnostics on the next launch that
succeeds. It lists startup crashes from the last 7 days with the error and component stack. Copy
the report and paste it into a [GitHub issue](https://github.com/SpaceDogA1/torch3/issues). Error
messages can quote values from the app, so read it over before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| Kiro        | Install [Kiro CLI](https://kiro.dev/docs/cli/), then run `kiro-cli login`.                                                                                |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from Torch3's provider settings.                                                                                          |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |
| fx          | Install [fx](https://fx.sh) with `curl -fsSL https://fx.sh/setup.sh \| bash`, then run `fx login`.                                                        |

Provider CLIs must be on the server's `PATH`. If Torch3 cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

Torch3 warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, mise, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or
the CLI's own update command when Torch3 cannot tell. Claude, Codex, and
OpenCode installs Torch3 cannot identify stay manual: update them through the
installer you used. Torch3 runs `mise upgrade`
only for a tool your mise config requests as `latest` when the provider's binary
path is a mise shim or under the tool's `installs/<tool>/latest` link; update a
pinned version, or a path into one version's directory, through mise yourself.
Update a CLI installed with Nix through Nix.
Cursor and Antigravity update with Torch3. Homebrew and Chocolatey installs
compare against the version their package manager offers, which can trail the
npm release; update Claude installed with Chocolatey through Chocolatey.

The managed runtimes for Antigravity and for Codex connected through ChatGPT
first install the release Torch3 tested. When Torch3 finds a newer compatible
release, their setup in **Settings → Providers** offers an update.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Torch3 does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Kiro](./providers-kiro.md),
[Pi](./providers-pi.md), [Muse Code](./providers-muse.md), and [fx](./providers-fx.md).

### Provider check timeouts

If a provider works in its CLI but Torch3 reports a timeout while checking it,
allow more time in the Torch3 server's environment. For example, give Codex and
Claude readiness checks 60 seconds:

```bash
T3CODE_CODEX_PROBE_TIMEOUT_MS=60000 T3CODE_CLAUDE_PROBE_TIMEOUT_MS=60000 torch3 serve
```

For a remote environment, set these on the machine running the Torch3 server.
Keep them in your launcher or service configuration to retain them across
updates, then restart the server. For systemd, add
`Environment=T3CODE_CODEX_PROBE_TIMEOUT_MS=60000` under `[Service]` in a service
override, reload systemd, and restart the service. Provider instances can also
set their own overrides in Settings → Providers.

Each variable extends that provider's readiness-probe deadlines; a phase whose
default is already longer keeps its default. Providers with several phases can
take longer than one deadline in total. Values must be whole milliseconds no
greater than 2147483647; unset or invalid values keep the defaults.

| Provider            | Environment variable                   |
| ------------------- | -------------------------------------- |
| Codex               | `T3CODE_CODEX_PROBE_TIMEOUT_MS`        |
| Claude              | `T3CODE_CLAUDE_PROBE_TIMEOUT_MS`       |
| Cursor              | `T3CODE_CURSOR_PROBE_TIMEOUT_MS`       |
| Antigravity         | `T3CODE_ANTIGRAVITY_PROBE_TIMEOUT_MS`  |
| Grok                | `T3CODE_GROK_PROBE_TIMEOUT_MS`         |
| Kiro                | `T3CODE_KIRO_PROBE_TIMEOUT_MS`         |
| fx                  | `T3CODE_FX_PROBE_TIMEOUT_MS`           |
| Pi                  | `T3CODE_PI_PROBE_TIMEOUT_MS`           |
| Muse Code           | `T3CODE_MUSE_PROBE_TIMEOUT_MS`         |
| OpenCode            | `T3CODE_OPENCODE_PROBE_TIMEOUT_MS`     |
| ACP Registry agents | `T3CODE_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

Longer deadlines also take longer to report a stalled check. These overrides
cover readiness and discovery, including OpenCode server startup. Usage and
config enrichment retain their own shorter limits. Turn execution, package
installation, update checks, and shutdown limits keep their existing behavior.

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a host available.
- [Updating Torch3](./updating.md): update the app and connected servers.
- [Managed policy](./managed-policy.md): configure Torch3 for everyone on a machine.
