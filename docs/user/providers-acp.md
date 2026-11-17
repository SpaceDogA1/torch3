# ACP providers

Torch3 can run installed ACP commands or coding agents from the official [ACP Registry](https://agentclientprotocol.com/get-started/registry).

Registry agents bring their own models, tools, and sign-in, while Torch3 provides projects,
threads, checkpoints, and task delegation.

> [!NOTE]
> Agents that Torch3 supports as their own providers, such as Codex, Claude, Cursor, Grok, OpenCode,
> Pi, and [Antigravity](./providers-antigravity.md), don't appear in the Registry list. Enable them
> in **Settings → Providers** instead.

## Protocol versions

Torch3 prefers the ACP v2 preview protocol and uses its richer messages, usage, plans,
configuration, compaction, and agent-terminal updates when the agent supports them. It also
negotiates ACP v1 for Registry agents that have not migrated yet.

Claude Agent uses the ACP v2 preview by default for Registry and local `claude-agent-acp`
commands. If you hit preview issues, set `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=0` in the provider
instance's environment overrides to use ACP v1.

## Add an agent

1. Open **Settings → Providers**.
2. Select **Add provider**, then **Show more**.
3. Search the ACP Registry for the agent and select **Add** on its result.
4. Confirm the name and instance ID, then complete the agent's sign-in step.

Search only shows agents that can run on the connected server.

> [!WARNING]
> Registry agents are third-party code. Review an agent's source and license before adding it.

## Add a local command

1. In **Settings → Providers → Add provider**, select **Show more**, then **Local ACP command**.
2. Enter the executable name or path on the selected environment.
3. Add one literal argument per row, and choose a display name.

For example, for DeepSeek Harness use `dsh` with arguments `--profile` and `acp`.

Local commands need no registry entry or download. Environment overrides apply to the command;
credentials and skills stay managed by the installed agent or its wrapper. Models and reasoning
options come from ACP, including model IDs that contain JSON. Torch3 launches the executable
directly without expanding shell expressions.

## Where agents run

Registry agents always run on the machine that hosts your Torch3 server, including when you
connect to it remotely.

Agents install under `tools/<agent-id>/<version>/` inside Torch3's data folder (`~/.torch3` by
default). Torch3 verifies SHA-256 when the Registry entry provides one; entries without a checksum
rely on the Registry's HTTPS distribution.

Registry `npx` and `uvx` packages use Torch3-owned npm prefixes and Python tool directories at the
exact version published by the Registry. Their commands are available in a new server terminal for
sign-in and direct use. Removing an agent's last provider instance removes managed binary files
but keeps package installs. To use an existing local binary, set **Executable override**.

## Signing in

1. Open the agent's account section in **Settings → Providers**.
2. Choose **Sign in** and, if the agent offers several methods, select one.

Browser sign-in shows the agent's URL and waits for you to open or copy it before telling the agent
to proceed. The page opens on your device, while the agent runs on the environment. Terminal
methods run in an in-app terminal on that environment. Torch3 reconnects after terminal login and
waits for the agent to confirm sign-in before reporting success. You can cancel or retry an expired
attempt.

Browser and terminal sign-in leave credentials in the agent's own store. Agents that read API keys
from environment variables still take those keys in the instance's environment settings. A
configured environment or agent home applies to both sign-in and chat.

If the agent advertises logout, choose **Sign out**. Changing a shared agent login stops running
threads for instances of that same agent on the environment; thread history and workspace files
are kept.

> [!NOTE]
> ACP does not describe account isolation, so adding another instance does not guarantee a separate
> account. Use the agent's own configuration to isolate accounts when it supports that.

If an agent cannot complete its advertised flow remotely, its CLI is still available on the server.
For example, Codex supports `codex login --device-auth`, and Grok Build supports
`grok login --device-auth`.

## Models and options

The model picker lists the models the agent reports. If the agent reports none, or hides some, add
your own model IDs under **Custom models** in the instance settings.

Other settings the agent offers, such as reasoning effort or approval mode, appear in the
composer's model picker beside the model list. Models and options that change while an agent runs
update the picker right away.

## Commands and skills

Slash commands the agent provides appear under **Provider** in the `/` menu while a session is
running. Commands the agent names with a `$` prefix appear in the `$` skill menu instead.

## Native sessions

When an agent supports ACP session listing and import, expand its provider card, choose a project,
and select **List sessions**. Importing a session creates a thread backed by it. Importing the same
session again returns the existing thread, even from another client.

The thread keeps the native session's title and last-update time without overwriting a title you
set. Agents that report ACP context usage drive the thread details context window and cumulative
cost; see [commands and skills](./composer.md#commands-and-skills) to show it. Text resources and
links render as assistant output. Binary resources, images, and audio that Torch3 cannot render
yet appear as placeholders instead of disappearing.

## Permissions and terminals

Registry agents read files, edit, and run commands themselves, under their own sandbox and
approval rules. They start in their own default mode, and their mode picker in the model options
menu switches it. How far an agent is confined depends on that mode and the agent's own settings.

When a Registry agent asks for approval, Torch3 answers by the thread's
[permission mode](./permission-modes.md):

| Mode                         | Response                               |
| ---------------------------- | -------------------------------------- |
| **Supervised**               | Shows the request in the conversation. |
| **Auto-accept edits**        | Approves edits and shows the rest.     |
| **Auto** and **Full access** | Approves automatically.                |

File reads and searches never wait for approval.

Devin runs its commands through Torch3's terminals, and those commands follow the thread's
permission mode. For other agents, Torch3 shows the command, output, and exit status the agent
reports but does not run or stop their terminals.

Registry agents can schedule work and use Torch3's MCP tools. How child tasks are shown depends on
what the agent exposes, since ACP has no portable subagent contract.

## Checkpoints

Checkpoint rollback restores your files as usual. ACP agents cannot rewind their own conversation,
so the next turn after a rollback starts a fresh agent session that no longer remembers the
conversation from before the checkpoint.

> [!NOTE]
> Registry instances are not used for app text generation, such as thread titles, commit messages,
> branch names, or pull request descriptions. Configure a provider that supports text generation
> for those.

## Advanced configuration

| Setting                   | Use                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Executable override**   | Runs an existing local executable instead of the managed one, keeping the Registry's arguments and environment. |
| **Authentication method** | Picks a specific method when the agent advertises more than one.                                                |
| **Custom models**         | Adds model IDs the agent does not report.                                                                       |
