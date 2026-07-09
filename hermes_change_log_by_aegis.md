# Hermes Change Log by Aegis

Append-only log for recording change intent when a task modifies non-test code
outside `aisoc/` and `aegis/`.

Start appending from the moment this rule is adopted. Do not backfill prior
tasks or historical repository changes.

## Required Summary Structure

- one or more `## File: \`path\`` blocks
- at least one `Feature` and `Intent` pair inside each file block
- multiple `Feature` / `Intent` pairs are allowed for the same file

## Field Meanings

- `Feature`: The capability, behavior, or responsibility affected by the change.
- `Intent`: Why the change was made, what constraint should be preserved, or what regression should be avoided.

## Template

```md
## File: `path/to/file`

Feature: Describe the affected capability, behavior, or responsibility.
Intent: Explain why this change exists and what it must preserve.
```

## Minimal Example

```md
## File: `cli.py`

Feature: Slash-command dispatch behavior.
Intent: Keep command routing predictable while extending an existing command flow without changing unrelated command semantics.
```
