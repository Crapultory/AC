# ExtCLI Delegate Loop Design

## Summary

This design extends AISOC `extcli` so terminal input and agent output are separated, while preserving a single frontmost interactive conversation. The main `extcli` loop continues to own terminal input. Agent output moves to a file sink, defaulting to `/tmp/extcli_output`. The new `delegate_ext` interactive mode can temporarily take over terminal input for a child agent session, then return control to the main session without losing either session's history.

This design does not implement nested interactive delegation, multiple foreground child sessions, or a generic Hermes-wide I/O abstraction. It only introduces enough routing and adapter behavior to support `extcli` and `delegate_ext`.

## When to Use

Use this design when extending AISOC's local CLI mode to:
- split terminal input from agent output
- keep the main terminal responsive while an agent turn runs
- allow a delegated child agent to enter a foreground interactive loop
- preserve child-agent session continuity across multiple user turns

Do not use this design as a template for multi-user, networked, or multi-pane chat orchestration. Those would need a broader eventing model.

## Prerequisites

- Existing AISOC `extcli` support in [aisoc/backend/extcli.py](/Users/guisheng.guo/.hermes/hermes-agent/aisoc/backend/extcli.py)
- Existing AISOC runtime helpers in [aisoc/backend/agent_runtime.py](/Users/guisheng.guo/.hermes/hermes-agent/aisoc/backend/agent_runtime.py)
- Existing `delegate_ext` tool in [tools/delegate_ext_tool.py](/Users/guisheng.guo/.hermes/hermes-agent/tools/delegate_ext_tool.py)
- Existing SessionDB-backed conversation restore path used by AISOC agents

## How to Run

Target invocation remains:

```bash
hermes aisoc --module extcli
```

Operational behavior after implementation:
- terminal input stays on stdin via `input_fn`
- agent output is written to `/tmp/extcli_output` by default
- the main session rejects new input while it is busy
- a foreground `delegate_ext(is_loop=true)` child session may temporarily consume user input
- `/main` or `/exit` inside the child foreground session returns control to the main `extcli`

## Quick Reference

### Main Session Rules

- `main` owns stdin by default
- `main` writes output through an output adapter, not `sys.stdout`
- if `main` is busy running an agent turn, new user input is rejected with a busy message
- `/new` resets the main session only when `main` is the active foreground target and is idle
- `/exit` exits the whole `extcli` only when `main` is the active foreground target

### Child Delegate Rules

- `delegate_ext(is_loop=false)` behaves like a one-shot delegated turn
- `delegate_ext(is_loop=true)` starts a foreground child loop and keeps the child session alive
- while a child loop is foregrounded, terminal input is routed to the child input adapter
- `/main` and `/exit` inside the child foreground session both end the child loop and return control to `main`
- child agents spawned by `delegate_ext` must not expose `delegate_ext` again

### Output Rules

- default output path: `/tmp/extcli_output`
- startup behavior: configurable, default is truncate-and-rewrite
- output format: human-readable prefixed lines by default
- internal adapter API keeps room for future structured output mode

## Procedure

### 1. Architecture

The implementation should be split into four focused units.

`ExtCliSessionRouter`
- Owns foreground session state
- Routes terminal input to either `main` or one foreground child session
- Enforces the "busy reject" rule for the main session
- Knows when control should return from child to main

`ExtCliOutputAdapter`
- Replaces direct writes to `sys.stdout`
- Writes to a file sink, defaulting to `/tmp/extcli_output`
- Emits human-readable prefixed lines such as `main.ai: ...` or `delegate[<session_id>].tool_call: ...`
- Internally accepts structured event writes so JSONL can be added later without redesigning callers

`ExtCliInputAdapter`
- Acts as a protocol adapter instead of a strict `TextIO`
- Exposes a blocking read operation suitable for child interactive loops
- Receives user input only through the session router

`delegate_ext` interactive executor
- Reuses the existing child-agent construction path
- Adds interactive loop behavior when `is_loop=true`
- Registers itself as the foreground input owner while active
- Releases control back to `main` on `/main`, `/exit`, input closure, or failure

### 2. Main ExtCLI Data Flow

`run_extcli_loop()` remains the top-level stdin reader. It does not surrender terminal ownership to worker threads.

For each line read from `input_fn("extcli> ")`:
- ask the session router for the active foreground target
- if the foreground target is `main`:
  - if main is idle, dispatch a background agent-turn worker
  - if main is busy, write a busy event to the output adapter and reject the input
- if the foreground target is `delegate`:
  - forward the raw user input to the active child input adapter
  - do not start a main-session agent turn

This keeps stdin handling synchronous and simple, while moving agent work off the input path.

### 3. Async Execution Model

`_run_agent_turn` should become asynchronous from the perspective of `run_extcli_loop`, not necessarily via `asyncio`. A dedicated worker thread is sufficient and better aligned with current code structure.

Required properties:
- the main loop must not block on a running agent turn
- only one main-session turn may run at a time
- only one foreground interactive child loop may exist at a time
- no user input should be queued for later replay into the main session
- child-loop foreground routing is the only exception to the main-session busy reject rule

This is intentionally a single-active-foreground model, not a general task scheduler.

### 4. Delegate Tool Contract

`delegate_ext` gains four new parameters:

- `is_delegate_output: bool = true`
- `output: protocol adapter | None = None`
- `is_loop: bool = true`
- `input: protocol adapter | None = None`

Behavior:

When `is_loop=false`:
- run one delegated child turn using the existing child-agent execution flow
- optionally stream child output to `output` if `is_delegate_output=true`
- return a standard tool result JSON envelope

When `is_loop=true`:
- send the initial `goal` as the first child-agent user turn
- keep the child session alive
- repeatedly wait for the next user message from `input`
- send each user message through the same child session
- treat `/main` and `/exit` as loop termination commands
- return the last child `final_response`

Validation rules:
- if `is_loop=true` and `input` is missing, return a tool error
- if `is_delegate_output=true` and `output` is missing, the tool may fall back to a no-op writer or parent print sink, but must not fail solely for that reason
- child tool capability must explicitly exclude `delegate_ext`

Returned result JSON should include:
- `success`
- `agent`
- `goal`
- `session_id`
- `toolsets`
- `max_iterations`
- `completed`
- `api_calls`
- `duration_seconds`
- `final_response`
- `loop_exit_reason`

`loop_exit_reason` values:
- `completed`
- `main_command`
- `input_closed`
- `error`

### 5. History and Session Continuity

The design keeps the current AISOC direction of using SessionDB-backed restoration rather than manually maintained in-memory history buffers.

Main-session continuity:
- the main AISOC agent session continues to rely on SessionDB restore on each turn

Child-session continuity:
- the child agent created by `delegate_ext(is_loop=true)` keeps its session ID for the full lifetime of the child loop
- each subsequent user message continues the same child session
- returning to main does not merge child conversation history into the main session; it only returns foreground input control

This preserves clear session boundaries and avoids contaminating the parent conversation transcript with the child's internal loop.

### 6. Output Format

Default mode is human-readable prefixed lines written through the output adapter. Example shapes:

```text
main.status: AISOC extcli ready
main.user: hello
main.ai: hi there
main.tool_call: web_search {"q":"cats"}
main.tool_result: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...
delegate[child-session].status: entered foreground loop
delegate[child-session].user: inspect src
delegate[child-session].ai: here is what I found
delegate[child-session].status: return to main
```

The adapter should internally accept structured events with at least:
- `source`
- `event_type`
- `session_id`
- `content`

The first implementation only needs to render these as prefixed text lines.

### 7. Exit Semantics

Main session:
- `/exit` exits the whole `extcli` only when `main` is the active foreground target
- `/new` is only valid when `main` is foregrounded and idle

Foreground child session:
- `/main` ends the child loop and returns control to `main`
- `/exit` has the same effect as `/main`
- neither command exits the whole `extcli` while a child loop owns foreground input

Input closure:
- if stdin closes while `main` is foregrounded, end the process cleanly
- if stdin closes while a child loop is foregrounded, close the child input adapter, let the child unwind with `loop_exit_reason=input_closed`, then end the process

### 8. Error Handling

Main-session agent turn failure:
- write an error event to the output adapter
- clear the main busy flag
- keep `extcli` alive for the next user input

Child-loop failure:
- write an error event to the output adapter
- return a tool result with `success=false` and `loop_exit_reason=error`
- always release foreground ownership back to `main`

Adapter failure:
- if output writing fails, surface one terminal-visible fallback error if possible, then prevent silent deadlock
- if input routing fails for a child loop, terminate the child loop with `loop_exit_reason=error`

### 9. Testing Strategy

Unit tests for `extcli` routing:
- startup uses `/tmp/extcli_output` by default
- startup truncate behavior is the default mode
- main-session busy input is rejected
- foreground child input receives routed lines
- `/main` or `/exit` in child loop returns control to `main`
- prefixed output rendering remains stable
- tool results still truncate to 50 characters

Unit tests for `delegate_ext`:
- `is_delegate_output` toggles child output emission
- `is_loop=true` without `input` returns a tool error
- interactive child loop consumes multiple user turns on one session
- `/main` exits and returns the last response
- `/exit` exits the child loop with the same behavior as `/main`
- child enabled tools do not include `delegate_ext`

Integration tests:
- `extcli -> delegate_ext(is_loop=true) -> child turns -> /main -> main turn`
- shared output file contains both main and child prefixes
- child failure returns control to main
- main remains usable after child exit

## Pitfalls

- Do not let both the main loop and child loop read stdin directly. Only the main loop should read terminal input.
- Do not queue main-session inputs while the main agent is busy. Rejection is part of the approved behavior.
- Do not merge child session transcripts into the main session transcript.
- Do not leave `delegate_ext` available to child agents.
- Do not treat `/exit` inside a foreground child loop as a process exit.
- Do not bind adapters to strict `TextIO` APIs. Use lightweight protocols or callables so routing stays flexible.

## Verification

The implementation will be correct when all of the following are true:
- `extcli` no longer writes normal output directly to `sys.stdout`
- `run_extcli_loop()` remains responsive to terminal input while agent work runs off-thread
- the main session rejects concurrent new turns while busy
- `delegate_ext(is_loop=true)` can hold one child session open across multiple user turns
- `/main` and `/exit` both return from the child loop to the main session
- child agents launched from `delegate_ext` cannot invoke `delegate_ext` again
- output is written to `/tmp/extcli_output` by default with readable source prefixes
