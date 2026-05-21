# Update Workflow

## Rule

Update the AI context in the smallest layer that accurately captures the change.

## Why

If every change goes only into `CLAUDE.md`, the entry file becomes bloated and decays. If nothing gets updated, future agents lose high-value context and repeat avoidable mistakes.

## How to apply

Decide first whether the change is an entry-point summary, a reusable project rule, or a durable project memory. Then update only the corresponding file(s).

## What to Update When

### Update `CLAUDE.md` when

- The one-sentence project overview is no longer accurate
- The most important development commands change
- The highest-priority critical rules change
- The rules index changes

Keep `CLAUDE.md` concise. It is a map, not a full handbook.

### Update `.claude/rules/*.md` when

- Architecture boundaries or primary entry points change
- The recommended way to modify commands, tools, gateway, TUI, or environment usage changes
- A new stable repository convention emerges
- The workflow for maintaining AI context changes

Rules should capture reusable guidance with clear reasons and application guidance.

### Update `.claude/memory/*.md` when

- A bug fix reveals a non-obvious recurring failure mode
- A technical decision has durable value beyond the current PR
- A real project-specific gotcha would help future sessions avoid repeating a mistake

Memory should contain durable learnings, not repo structure or code facts that can be read directly from the tree.

## Memory Writing Standard

For entries in memory files:

- Record the lesson, not a full incident transcript
- Include why it matters
- Make the future application explicit
- Do not duplicate architecture or conventions material

## Anti-Patterns

Do not use memory for:

- file inventories
- module summaries that belong in architecture
- temporary task status
- speculative future ideas
- facts that are better read from code or git history
