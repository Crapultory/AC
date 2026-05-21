# Environment

## Rule

Use the repository's established development environment and execution wrappers rather than ad hoc commands.

## Why

This repository spans Python, Node-based TUI code, plugins, and multiple runtime surfaces. The documented wrappers and path helpers keep behavior consistent across local checkouts, worktrees, and CI-like runs.

## How to apply

When running or testing the project, prefer the documented commands here unless a task explicitly requires a lower-level invocation.

## Python Environment

```bash
source .venv/bin/activate
# or
source venv/bin/activate
```

`scripts/run_tests.sh` probes `.venv`, then `venv`, then `$HOME/.hermes/hermes-agent/venv` for shared-worktree setups.

## Test Execution

Use the wrapper:

```bash
scripts/run_tests.sh
scripts/run_tests.sh tests/some_directory/
scripts/run_tests.sh tests/path/to/test_file.py::test_name
```

Avoid calling `pytest` directly for routine verification unless there is a specific reason.

## Runtime Entry Points

- `./hermes` — main project launcher in a repository checkout
- `hermes` — installed CLI
- `hermes --tui` — explicit TUI mode
- `hermes gateway` — messaging gateway entry point

## User Config and Logs

- User config: `~/.hermes/config.yaml`
- User env secrets: `~/.hermes/.env`
- Logs: `~/.hermes/logs/`

Within code, use the profile-aware helpers from `hermes_constants.py` rather than hard-coded home-directory paths.

## Mixed-Stack Notes

- `ui-tui/` contains the Ink/React frontend
- `tui_gateway/` contains the Python backend for the TUI
- `website/` contains the docs site
- `node_modules/` is present in the repo, but generated/build outputs and local environment artifacts should not drive context documentation
