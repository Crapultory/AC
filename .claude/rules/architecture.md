# Architecture

## Rule

Use this file as the high-level module map for Hermes Agent. Read it before making changes that cross subsystem boundaries.

## Why

The repository is large and spans multiple entry points, runtime surfaces, and extension systems. A concise architecture map helps agents find the right place to work without over-reading the whole tree.

## How to apply

When a task touches behavior across multiple files or systems, start from the relevant entry point here and then drill into the specific implementation files.

## Core Entry Points

- `run_agent.py` — `AIAgent` conversation loop and central runtime behavior
- `cli.py` — interactive CLI orchestration and slash-command handling
- `model_tools.py` — tool discovery, tool orchestration, and function-call dispatch
- `toolsets.py` — toolset definitions and core tool grouping
- `hermes_state.py` — session storage and retrieval
- `hermes_constants.py` — profile-aware path helpers like `get_hermes_home()` and `display_hermes_home()`

## Major Subsystems

- `agent/` — agent internals such as memory, caching, compression, and provider adapters
- `tools/` — tool implementations, discovered through `tools/registry.py`
- `gateway/` — messaging gateway runtime and per-platform adapters
- `hermes_cli/` — CLI subcommands, skin engine, setup flows, and related support code
- `ui-tui/` — Ink/React terminal UI
- `tui_gateway/` — Python JSON-RPC backend for the TUI
- `plugins/` — plugin ecosystem including memory, model providers, observability, kanban, and more
- `skills/` and `optional-skills/` — built-in and optional procedural skills
- `website/` — documentation site
- `tests/` — pytest suite

## Important Dependency Flows

### Tools

`tools/registry.py` is the registration root. Tool implementations register there, `model_tools.py` discovers built-in tools, and runtime entry points call into the dispatcher.

Typical flow:

`tools/*.py` → `tools/registry.py` → `model_tools.py` → runtime entry points

### Slash commands

Slash commands are centrally defined in `hermes_cli/commands.py` through `COMMAND_REGISTRY`. CLI and gateway behavior derive from that registry rather than each keeping their own command list.

Typical flow:

`hermes_cli/commands.py` → `cli.py` and gateway command surfaces

### TUI

The TUI is an Ink frontend in `ui-tui/` talking over stdio JSON-RPC to the Python backend in `tui_gateway/`.

## Where to Start by Task Type

- Agent runtime behavior: start with `run_agent.py` and `agent/`
- Tool behavior or tool registration: start with `model_tools.py` and `tools/registry.py`
- Slash commands or CLI settings: start with `hermes_cli/commands.py` and `cli.py`
- Gateway command handling or platform behavior: start with `gateway/`
- TUI behavior: inspect both `ui-tui/` and `tui_gateway/`
- Profile-aware config or file paths: inspect `hermes_constants.py` before using hard-coded home-directory paths
