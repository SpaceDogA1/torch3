# Pi

Torch3 runs your existing Pi coding agent and keeps Pi's models, auth, extensions, skills, context files, and native session history.

## Set up Pi

1. Install [Pi](https://pi.dev) on the machine running the Torch3 server. Pi requires Node.js
   22.19 or newer; its platform installers can install Node if needed. Torch3 supports Pi
   0.84.3 or newer.
2. Run `pi` in a terminal, then `/login` to connect your model provider or configure its API key.
3. Open Torch3 **Settings → Providers**, enable Pi, and refresh the provider.

For an npm installation, use:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

If `pi` is not on the server's `PATH`, set Pi's binary path to the executable. Provider environment
variables and launch arguments are also available for installations that need a custom agent
directory, endpoint, or model configuration.

> [!NOTE]
> `--provider` must be paired with `--model`. Torch3 rejects launch arguments that change Pi's
> execution mode or select a session, because Torch3 manages those parts of the process.

### Sign in on a remote or headless server

Connect to that machine over SSH, run `pi`, then `/login`. Open the authorization URL on your own
computer. If the callback cannot reach the server, paste the final redirect URL or authorization
code back into Pi when prompted.

You can also set your model provider's API-key environment variable in the Pi instance's settings.
Mark secret values as sensitive.

### Update Pi

Update installer-managed Pi with `pi update`. If another package manager owns the installation,
update it through that manager instead. For example, a Nix profile installation uses
`nix profile upgrade pi`.

## What carries over

- **Models and thinking levels.** Torch3 lists the models Pi reports and their supported thinking
  levels. The active model's configured level is marked as its default; other models keep their Pi
  defaults when no level is selected.
- **Speed tiers.** A model that lists `serviceTiers` (for example
  `[{ "id": "priority", "name": "Fast" }]`) in its Pi definition gets a speed picker with Standard
  plus those tiers. A chosen tier is sent as the request's `service_tier`; Standard leaves the
  endpoint's default.
- **Sessions.** Threads use Pi's native session files for resume, rollback, and forks within the
  same Pi instance. Forks keep the native conversation through the selected turn. Switching
  providers uses portable conversation context.
- **Context window.** The thread details context window follows Pi's own usage reporting.
- **Skills.** User and project skills that Pi loads for the workspace appear in the composer's `$`
  menu and use Pi's native skill expansion.
- **Extensions.** Pi loads its user extensions, and project extensions once the folder is trusted in
  Pi. Blocking `select`, `confirm`, `input`, and `editor` dialogs appear in the composer,
  notifications appear in the work log, and extensions can show status text near the composer.
  Terminal titles and generic widgets have no Torch3 equivalent.

## Permission modes

Torch3 applies the composer permission mode through Pi's blocking tool hook:

| Mode                  | Behavior                                                                      |
| --------------------- | ----------------------------------------------------------------------------- |
| **Supervised**        | Asks before commands, file changes, and extension tools. Read-only tools run. |
| **Auto-accept edits** | Allows Pi's edit and write tools; asks before commands and extension tools.   |
| **Full access**       | Allows tools without approval prompts.                                        |

**Auto** is not offered because Pi has no AI approval reviewer. Threads that stored Auto earlier
behave and display as Supervised.

Changing the mode restarts the Pi session and resumes the same native conversation.

> [!WARNING]
> The permission mode covers Pi tool calls only. It is not an operating-system sandbox, and code a
> trusted Pi extension runs outside a tool call is governed by Pi's own extension trust model.

## Subagents

The `delegate_task` tool creates durable child threads in the shared subagent view. If you install
Pi's example `subagent` extension, Torch3 also shows its task progress and results there. Pi runs
those children without a session, so they cannot be opened or resumed as threads.

## Troubleshooting

- **Pi is unavailable.** Confirm that the configured binary runs on the server machine, then refresh
  the provider in Settings.
- **No models appear.** Open Pi directly and confirm its authentication and model configuration.
- **Discovery cannot complete.** Torch3 keeps Pi available with the `Pi default` model. Start a
  thread to let the interactive Pi session handle any startup prompt.
- **Folder not trusted.** If Pi skips project settings, extensions, skills, prompts, MCP servers, or
  system prompt files because the folder is untrusted, the thread shows a notice on its first Pi
  turn. Run the configured Pi binary in that folder on the server machine with the same provider
  environment, including `PI_CODING_AGENT_DIR` if set. Trust the folder or its parent with
  `/trust`, then start a new thread in the same worktree. Launch arguments with `--no-approve` keep
  project files off without the notice.
- **No context usage shown.** Turn on **Context window** in **Settings → Appearance → Thread
  details**. It appears once Pi reports usage; some model providers only report it when a response
  completes.
