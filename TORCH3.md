<img src="assets/icon.svg" width="64" height="64" alt="">

# Torch3

Created in [T3 Code](https://t3.codes).

Torch3 is a fork of [T3 Code](https://github.com/pingdotgg/t3code) that integrates
[ORCH (Orchestry)](https://github.com/oxgeneral/ORCH) as a background multi-agent
orchestration engine. T3 Code remains the application and GUI; ORCH owns multi-agent
coordination.

## Fork layout

- `README.md` is upstream T3 Code's README, kept unmodified so upstream syncs merge cleanly.
- This file holds the fork's own notes. The original Torch3 README content is above.
- The pre-fork repository state is preserved at tag `backup/pre-fork-4128497`.

## Remotes

- `upstream`: https://github.com/pingdotgg/t3code.git (fetched blob-less; `.repos/` excluded
  by sparse checkout, as upstream's AGENTS.md allows)
- `orch-upstream`: https://github.com/oxgeneral/ORCH.git

To sync: `git fetch upstream main && git merge upstream/main`.
