# Conventions

## Rule

Follow existing repository patterns, keep changes narrowly scoped, and look for central registration points before editing leaf files.

## Why

Hermes Agent has multiple generated surfaces and derived behaviors. Editing only the obvious leaf file often misses the real source of truth and causes inconsistent behavior.

## How to apply

Before changing behavior, identify whether the relevant feature is driven by a registry, dispatcher, or shared helper. Prefer the source of truth over patching downstream effects.

## Editing Conventions

- Prefer editing existing files over creating new ones unless a new file is the clearest fit.
- Do not add unrelated refactors while making task-specific changes.
- Follow surrounding naming, structure, and style in the touched area.
- Keep documentation concise at the entry point and put detailed guidance in topic-specific files.

## Change-Specific Guidance

### Commands

- For slash commands, check `hermes_cli/commands.py` first.
- Treat `COMMAND_REGISTRY` as the canonical command list.
- If a command affects persisted settings, check whether `save_config_value()` is already the established path.

### Tools

- For tool additions or edits, inspect `tools/registry.py` and `model_tools.py` before changing individual tool files.
- Preserve existing registration and discovery patterns.

### Gateway and TUI

- For gateway behavior, look for shared command resolution or central routing before changing a single platform adapter.
- For TUI changes, confirm whether the behavior belongs in the Ink frontend, the Python gateway, or the PTY-backed terminal path.

### Paths and state

- Use profile-aware path helpers instead of hard-coded `~/.hermes` logic inside code.
- For user-facing paths, prefer the display helper used by the codebase.

## Testing Conventions

- Use `scripts/run_tests.sh` for normal project test execution.
- Prefer targeted tests that match the changed area before broader verification.
- Keep tests close to the changed behavior and avoid broad speculative test additions.
