# Project Memory

This file records project-level working memory for this repository.

## Aegis Change-Intent Logging Rule

- Scope: When a task modifies non-test code outside `aisoc/` and `aegis/`, record the detailed change intent in `hermes_change_log_by_aegis.md`.
- Exclusions: Changes inside `aisoc/`, changes inside `aegis/`, and test-only changes do not require an entry in `hermes_change_log_by_aegis.md`.
- Recording unit: The log must be written per file, using the target file as the unit of record.
- Required detail: Each recorded file must explain what capability, behavior, or responsibility changed, and why the change was made.
- File target: All qualifying entries must be appended to the repository-root `hermes_change_log_by_aegis.md`.
- Review gate: After code changes for a task are complete, perform a review before deciding whether the task is truly complete or needs more edits.
- Boundary: This rule lives only in this repository `MEMORY.md`. It is not mirrored into `AGENTS.md`.
