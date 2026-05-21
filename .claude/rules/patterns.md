# Patterns

## Rule

Use this file for repeatable modification patterns in Hermes Agent rather than for one-off implementation details.

## Why

Large repositories are easier to change safely when common edit paths are documented as patterns. This reduces time spent rediscovering where behavior is actually wired.

## How to apply

Match the requested change to one of the patterns below, then inspect the named source files before editing.

## Common Patterns

### Add or change a slash command

Start with:

- `hermes_cli/commands.py`
- `cli.py`
- `gateway/run.py` if the command also affects messaging platforms

Pattern:

1. Find or update the command definition in `COMMAND_REGISTRY`
2. Check CLI dispatch in `cli.py`
3. If gateway-visible, check gateway handling and derived command surfaces
4. Verify any persisted settings path follows existing config helpers

### Add or change a tool

Start with:

- `tools/registry.py`
- `model_tools.py`
- the specific `tools/*.py` implementation file

Pattern:

1. Confirm where the tool is registered
2. Check how discovery and dispatch reach it
3. Make the narrowest implementation change consistent with the existing tool model
4. Verify the affected tests or add targeted coverage in `tests/`

### Change gateway behavior

Start with:

- `gateway/`
- `hermes_cli/commands.py` if command parsing is involved

Pattern:

1. Determine whether the change is platform-specific or shared
2. Prefer shared routing or shared command logic when possible
3. Only patch a single platform adapter when the behavior is truly platform-local

### Change TUI behavior

Start with:

- `ui-tui/`
- `tui_gateway/`
- `hermes_cli/pty_bridge.py` or related PTY/web integration code if relevant

Pattern:

1. Decide whether the behavior belongs in the Ink UI or Python backend
2. Preserve the existing TUI/backend boundary
3. Avoid duplicating chat behavior outside the established TUI path

### Change profile-aware paths or stored state

Start with:

- `hermes_constants.py`
- code using config, logs, cache, checkpoints, or profile-specific files

Pattern:

1. Look for existing helpers before adding a direct filesystem path
2. Use profile-aware helpers consistently
3. Keep user-facing path text aligned with the display helper used by the repo
