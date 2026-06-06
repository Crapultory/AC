# Slack Gateway A2A Foreground Routing Design

## Summary

Add Slack gateway support for the AISOC `extcli`-style foreground delegate interaction model while keeping the existing Slack thread unchanged. After `a2a_delegate(is_loop=true)` enters foreground mode, later user messages in the same Slack thread should be routed directly to the delegate session instead of starting new main-agent turns. Manual return to the main session is supported via `/main` and `/exit` equivalents inside the Slack thread. Other Slack gateway behavior remains unchanged.

This design intentionally reuses the existing extcli-compatible delegate input/output protocol already implemented by `a2a_delegate`. It avoids changing `tools/a2a_delegate_tool.py` and instead connects Slack to the same `_delegate_ext_input_factory` and `_delegate_ext_output_adapter` runtime hooks through a small injection point in `gateway/run.py`.

## Goals

- Support foreground delegate interaction in Slack threads without creating a new Slack thread.
- Reuse the existing `a2a_delegate` loop behavior and extcli-compatible hooks.
- Keep normal Slack gateway behavior unchanged when no foreground delegate session is active.
- Limit code changes to `gateway/platforms/slack.py` and a small hook injection in `gateway/run.py`.

## Non-Goals

- Do not introduce a new delegate signaling protocol in `tools/a2a_delegate_tool.py`.
- Do not persist foreground delegate routing state across gateway restarts.
- Do not change session-store persistence rules or rebind `session_key -> delegate_session_id`.
- Do not add reliable auto-return-to-main on delegate completion in this phase.

## Background

AISOC `extcli` already supports delegate foreground routing by injecting:

- `_delegate_ext_input_factory`
- `_delegate_ext_output_adapter`

into the parent agent before `run_conversation()`. The delegate tool then:

- calls `input.enter_foreground()` when loop mode starts
- calls `input.exit_foreground()` when loop mode ends
- reads later user input from `input.read_line()`
- emits delegate events through `output.emit(...)`

This is the real control path in extcli. The emitted `delegate.status` text is useful for observability, but the actual foreground switch is driven by the input adapter callbacks.

## Chosen Approach

Reuse the existing extcli-compatible runtime protocol and connect Slack to it.

### Why this approach

- It uses the same mechanism already proven in extcli.
- It avoids introducing a second delegate signaling protocol.
- It keeps `tools/a2a_delegate_tool.py` unchanged.
- It preserves the user's request to keep changes concentrated in `slack.py`.

### Why not use a new parent callback

A new `parent_agent._delegate_signal_callback(payload)` design would be cleaner in isolation, but it would require changes to the tool implementation and create a second protocol that overlaps with the already-working extcli hook pair. That adds complexity without enough benefit for this Slack-only feature.

## Architecture

### 1. `gateway/run.py`: inject Slack delegate adapters into the current agent

When the current platform is Slack, `GatewayRunner` will attach two runtime objects to the agent on each turn:

- `_delegate_ext_input_factory`
- `_delegate_ext_output_adapter`

This must happen after the agent is created or reused from cache, and before the turn is executed.

The injection is per-turn, not constructor-only, because cached agents are reused across turns and must receive fresh Slack-thread-scoped routing objects every time.

### 2. `gateway/platforms/slack.py`: add a thread foreground router

Slack will maintain a lightweight in-memory router keyed by the Slack thread root:

- `channel_id`
- `root_thread_ts`

Each route entry stores:

- current foreground mode: `main` or `delegate`
- current delegate input adapter
- delegate session id if known
- associated main session key
- last activity timestamp

This state is runtime-only and is cleared naturally on restart.

### 3. `tools/a2a_delegate_tool.py`: unchanged

The delegate tool already does what Slack needs:

- enter foreground through `input.enter_foreground()`
- exit foreground through `input.exit_foreground()`
- consume delegate user input through `read_line()`
- emit delegate events through `output.emit(...)`

Slack will consume this protocol rather than redefining it.

## Runtime Flow

### Main turn path

1. A normal Slack message arrives in a thread.
2. Slack resolves the thread root and looks up the thread foreground router state.
3. If the thread is in `main` mode, Slack follows the existing message path and dispatches through the regular gateway message handler.
4. `gateway/run.py` injects Slack delegate adapters into the agent.
5. If the model calls `a2a_delegate(is_loop=true)`, the existing tool implementation uses those injected adapters.

### Delegate foreground enter

1. `a2a_delegate` calls `input.enter_foreground()`.
2. Slack's injected input adapter updates the thread route from `main` to `delegate`.
3. The route now owns a live delegate input adapter for that Slack thread.
4. Delegate output continues to appear in the same Slack thread through the injected output adapter.

### Delegate foreground message routing

1. A later user message arrives in the same Slack thread.
2. Before normal Slack gateway dispatch, `slack.py` checks the thread route.
3. If the route is in `delegate` mode, the message is pushed to the delegate input adapter instead of creating a new main-agent turn.
4. The delegate session consumes the text as its next loop input.

### Return to main

Manual return is supported.

When the thread is in delegate foreground mode:

- `!main`
- `!exit`
- `/main`
- `/exit` if received as plain text

are routed into the delegate input adapter. The existing tool implementation already interprets `/main` and `/exit` as return-to-main commands in loop mode.

When the delegate tool later calls `input.exit_foreground()`, Slack restores the thread route to `main`.

### `/new` behavior

When the thread is in delegate foreground mode, `/new` is not treated as a main-session reset. It is forwarded to the delegate input adapter as ordinary delegate input, matching extcli behavior.

## Slack Adapter Design

### New internal concepts

`slack.py` gains:

- a thread-route key helper based on `(channel_id, root_thread_ts)`
- an in-memory route-state structure
- a Slack delegate input adapter
- a Slack delegate output adapter

### Slack delegate input adapter

Responsibilities:

- expose `enter_foreground()`
- expose `exit_foreground()`
- expose `push_line()`
- expose `read_line()`
- expose `close()`
- optionally expose waiting-state helpers similar to extcli if needed by tests

`enter_foreground()` moves the route state to `delegate`.

`exit_foreground()` clears the delegate adapter from the route and restores `main`.

### Slack delegate output adapter

Responsibilities:

- expose `emit(source, event_type, content, session_id=None)`
- send delegate output back into the same Slack thread

This adapter is not the control plane. It is the display and observability surface for delegate events already emitted by the tool.

## Busy and Concurrency Rules

### Main mode

When no delegate foreground session is active, Slack retains all existing busy, queue, and active-session behavior.

### Delegate mode

When a thread is in delegate foreground mode:

- later thread messages should not start ordinary main-agent turns
- later thread messages should not be blocked by the main-session active guard
- later thread messages should go straight to the delegate input adapter

This is a Slack-local routing decision, not a change to session-store semantics.

### Failed delegate push

If Slack tries to push a message into the delegate adapter and it fails:

1. clear the delegate foreground route state
2. fall back to `main`
3. re-process the same message through the normal Slack gateway path

This prevents silent message loss.

## Session Semantics

This design intentionally does not change persistent session bindings.

### No session-store rebinding

Do not switch the Slack thread's `session_key` to the delegate session id.

Why:

- it would interact with cached agents
- it would create `/resume`-like side effects
- it would complicate compression-tip and descendant handling
- it is unnecessary for runtime foreground routing

Instead, the delegate session remains owned by the delegate tool runtime, and Slack only routes later user input to that runtime while foreground mode is active.

### Restart behavior

Foreground delegate routing is runtime-only. If the gateway restarts:

- in-memory delegate foreground state is lost
- the Slack thread falls back to main-session behavior

This is acceptable and matches the "foreground interaction is live runtime state" model.

## Auto Return to Main

This phase does not promise reliable auto-return-to-main on delegate completion.

Reason:

- `tools/a2a_delegate_tool.py` is intentionally unchanged
- loop mode currently waits for more input after each turn
- there is no dedicated completion callback that Slack can trust as a foreground-exit signal in every case

Supported return paths in this phase:

- explicit `/main`
- explicit `/exit`
- any path where the delegate runtime calls `exit_foreground()`

## Files to Change

### `gateway/run.py`

Add a small per-turn injection step for Slack agents:

- set `_delegate_ext_input_factory`
- set `_delegate_ext_output_adapter`

This should happen for both newly created and cached agents.

### `gateway/platforms/slack.py`

Add:

- thread-route state storage
- thread-root resolution helper for foreground routing
- Slack delegate input/output adapters
- delegate-mode pre-dispatch interception for thread messages
- cleanup logic when foreground delegate mode exits or becomes invalid

## Testing Plan

### Slack adapter unit tests

- entering foreground changes thread route to `delegate`
- exiting foreground restores `main`
- delegate foreground messages call `push_line()` instead of normal dispatch
- failed `push_line()` clears delegate state and falls back to normal dispatch
- `/new` in delegate mode is forwarded to the delegate channel, not treated as main reset

### Gateway runner unit tests

- Slack platform turns inject `_delegate_ext_input_factory`
- Slack platform turns inject `_delegate_ext_output_adapter`
- cached Slack agents still receive fresh delegate adapters on later turns

### End-to-end behavior tests

- same-thread follow-up after `a2a_delegate(is_loop=true)` goes to delegate
- `!main` or `/main` returns thread routing to main
- local and remote A2A delegate paths both work with the same Slack routing contract

## Risks

- This is Slack-specific runtime logic layered alongside the normal gateway session model.
- The route state is in-memory and not restart-safe by design.
- Auto-return-to-main is intentionally deferred.
- If future platforms need the same capability, the router may later be generalized into a platform-agnostic foreground delegation layer. That refactor is explicitly out of scope for this change.

## Acceptance Criteria

- A Slack thread remains the same visible thread before and after delegate foreground entry.
- After `a2a_delegate(is_loop=true)` enters foreground, later messages in that thread are routed to the delegate session.
- `/main` and `/exit` restore the thread to main-session routing.
- `/new` while delegate is foreground is treated as delegate input, not a main reset.
- Existing Slack behavior is unchanged when no foreground delegate session is active.
- `tools/a2a_delegate_tool.py` remains unchanged.
