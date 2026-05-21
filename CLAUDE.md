# Hermes Agent AI Context

## Project Overview

Hermes Agent is a self-improving AI agent platform with multiple user interfaces and execution surfaces, including CLI, messaging gateway, TUI, ACP integrations, tools, plugins, skills, and scheduling.

## Development Commands

```bash
# Prefer .venv; fall back to venv if needed
source .venv/bin/activate
# or
source venv/bin/activate

# Run the full test workflow through the project wrapper
scripts/run_tests.sh

# Run a targeted test
scripts/run_tests.sh tests/path/to/test_file.py::test_name

# Start the main CLI
./hermes

# Start the TUI explicitly
hermes --tui
```

## Critical Rules

1. Check the relevant registry or dispatch chain before editing commands, tools, plugins, or providers.
2. Follow existing repository patterns and keep changes tightly scoped to the requested task.
3. Prefer editing existing files over introducing new files unless a new file is clearly required.
4. Use `scripts/run_tests.sh` rather than calling `pytest` directly for normal verification.
5. Keep `.claude/memory/` for durable project learnings and gotchas, not for facts that can be read directly from the codebase.

## Rules Index

| File | Purpose |
| --- | --- |
| `.claude/rules/architecture.md` | High-level module map, entry points, and dependency flows |
| `.claude/rules/conventions.md` | Repository editing conventions and change-scope expectations |
| `.claude/rules/environment.md` | Development environment, runtime entry points, config, and logs |
| `.claude/rules/patterns.md` | Common change patterns for commands, tools, gateway, and TUI work |
| `.claude/rules/update-workflow.md` | When to update AI context files and what belongs in each layer |
| `.claude/rules/MEMORY.md` | Index of persistent project memory files |

## Additional Context

- `AGENTS.md` contains detailed repository guidance and should be treated as a supplemental deep reference.
- `CLAUDE.md` is the concise entry index for recurring AI-assisted work in this repository.
