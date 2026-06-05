# Delegate Ext A2A Design

## Summary

This design extends `delegate_ext` with remote A2A delegation and adds an `a2a_list` discovery tool in the same module. The implementation keeps the existing local delegation behavior intact, introduces a module-level A2A registry cache in [tools/delegate_ext_tool.py](/Users/guisheng.guo/.hermes/hermes-agent/tools/delegate_ext_tool.py), and allows `delegate_ext(agent="a2a")` to reuse one remote A2A task/context across a foreground child loop.

This design does not change the extcli routing model, does not introduce nested remote delegation, and does not add a new standalone AISOC registry service. It only adds enough registry, discovery, and remote conversation plumbing to support named A2A delegation from the existing tool surface.

## When to Use

Use this design when:
- local `delegate_ext` is already working and you want a remote A2A backend as an alternative execution target
- the current Hermes profile should own a simple named A2A endpoint registry
- the model needs a discovery tool to inspect configured A2A agents and their capabilities before delegating

Do not use this design for:
- dynamic service discovery outside the current Hermes profile
- generic multi-hop remote orchestration
- nested delegated child agents that themselves expose `delegate_ext`

## Prerequisites

- Existing local delegation logic in [tools/delegate_ext_tool.py](/Users/guisheng.guo/.hermes/hermes-agent/tools/delegate_ext_tool.py)
- Existing SessionDB-backed child-loop continuity already used by local `delegate_ext`
- Existing AISOC A2A server implementation in [aisoc/backend/a2a_server.py](/Users/guisheng.guo/.hermes/hermes-agent/aisoc/backend/a2a_server.py)
- Optional A2A SDK dependency already present in AISOC backend requirements
- Current Hermes profile directory, used as the base location for `a2a.json`

## How to Run

The new discovery tool will be available to Hermes as:

```text
a2a_list()
```

Named remote delegation will be available as:

```text
delegate_ext(
  goal="...",
  agent="a2a",
  a2a_name="test",
  is_loop=true
)
```

Profile-local registry source:

```json
{
  "a2a": {
    "test": "http://127.0.0.1/a2a"
  }
}
```

For each configured URL, the implementation reads:

```text
<base_url>/.well-known/agent-card.json
```

and exposes the resulting capability summary to the model.

## Quick Reference

### New Tool

- `a2a_list`
  - reads the current profile's `a2a.json`
  - refreshes a module-level A2A registry cache
  - returns configured names, URLs, availability, agent-card metadata, and capability summaries
  - keeps broken entries and reports their error instead of dropping them

### Extended Delegate Tool

- `delegate_ext(agent="local")`
  - unchanged core behavior
  - `toolsets` and `max_iterations` remain local-only settings

- `delegate_ext(agent="a2a")`
  - requires `a2a_name`
  - ignores `toolsets`
  - ignores `max_iterations`
  - reuses one remote A2A task/context for the full child loop when `is_loop=true`
  - returns `agent_card_name` in the final result envelope

### A2A Registry Rules

- registry source file: `<current profile>/a2a.json`
- registry cache lives as a module-global variable in `delegate_ext_tool.py`
- missing `a2a.json` is treated as an empty registry, not a hard error
- malformed `a2a.json` is a tool error
- agent-card fetch failure preserves the entry with `available=false`, empty capabilities, and an `error` field

## Procedure

### 1. Module Layout

Keep the implementation in [tools/delegate_ext_tool.py](/Users/guisheng.guo/.hermes/hermes-agent/tools/delegate_ext_tool.py) and add four focused groups of helpers:

- registry loading helpers
- agent-card fetch and capability extraction helpers
- remote A2A conversation helpers
- tool entrypoints and schemas

The file may grow, but the functions should remain sharply separated so later extraction stays mechanical if the module becomes too large.

### 2. Module-Level A2A Registry

Add a module-global cache:

```python
A2A_REGISTRY: dict[str, dict[str, Any]] = {}
```

Each entry should store the structured view of one configured remote agent:

- `name`
- `url`
- `available`
- `capabilities`
- `agent_card`
- `agent_card_name`
- `error`

The cache exists for two reasons:
- `a2a_list` needs a stable structured return value
- `delegate_ext(agent="a2a")` should be able to resolve an agent by name without reparsing raw config every time

If the requested `a2a_name` is missing from cache, `delegate_ext` should trigger one refresh before failing.

### 3. Registry Source and Loading

The registry source is the current profile's `a2a.json`. The loader should resolve the active Hermes home first, then look for:

```text
<hermes_home>/a2a.json
```

Expected file shape:

```json
{
  "a2a": {
    "test": "http://127.0.0.1/a2a"
  }
}
```

Loading rules:
- if the file does not exist, return an empty registry result
- if the top-level JSON is malformed, return a tool error
- if the `a2a` key is missing or not a mapping, treat it as malformed input
- normalize each configured URL enough to form the agent-card path consistently

The loader should update `A2A_REGISTRY` atomically from the parsed result so the module never exposes a half-built cache.

### 4. Agent Card Fetch and Capability Extraction

For each configured base URL, fetch:

```text
<base_url>/.well-known/agent-card.json
```

The fetch helper should return either:
- parsed card JSON
- or a human-readable error string

The extraction helper should produce a structured capability summary instead of passing only raw card JSON through to the model. The returned entry should include:

- `agent_card_name`
- a compact `agent_card` summary
- `capabilities`

`capabilities` should be derived from well-known card fields when present and degrade gracefully when fields are missing or shaped differently than expected. The raw summary should remain lightweight enough for model consumption, not a verbatim full-card dump unless the card is already very small.

If the card fetch fails:
- keep the registry entry
- set `available=false`
- set `capabilities=[]`
- set `agent_card_name=None`
- populate `error`

### 5. New `a2a_list` Tool

Add a new tool in [tools/delegate_ext_tool.py](/Users/guisheng.guo/.hermes/hermes-agent/tools/delegate_ext_tool.py):

- name: `a2a_list`
- purpose: discover configured A2A agents and their capability summaries

Return envelope:
- `success`
- `count`
- `registry_path`
- `agents`

Each `agents[]` item contains:
- `name`
- `url`
- `available`
- `capabilities`
- `agent_card`
- `agent_card_name`
- `error`

Behavior:
- refreshes the module-global registry from disk
- returns an empty list when `a2a.json` is absent
- fails when `a2a.json` is malformed

This tool should be separately discoverable by the model rather than hidden behind `delegate_ext`.

### 6. `delegate_ext` Schema Changes

Extend `delegate_ext` with:

- `a2a_name: string`

Parameter rules:
- `a2a_name` is required only when `agent="a2a"`
- `toolsets` is local-only
- `max_iterations` is local-only
- `is_delegate_output`, `output`, `is_loop`, and `input` continue to apply to both local and A2A modes

The schema descriptions should explicitly say:
- `toolsets` is only used for `local`
- `max_iterations` is only used for `local`
- `a2a_name` is only used for `a2a`

### 7. Remote A2A Delegation Flow

When `delegate_ext(agent="a2a")` is selected:

1. Validate that `a2a_name` is present
2. Refresh registry if needed
3. Resolve the named entry from `A2A_REGISTRY`
4. Fail with a helpful error if missing, including available names when possible
5. Fail early if the named entry is known unavailable and has an `error`
6. Build a remote A2A client using the resolved URL and card metadata
7. Send the first user turn using `goal`

The remote result envelope should mirror the local one as closely as possible:

- `success`
- `agent="a2a"`
- `a2a_name`
- `goal`
- `session_id`
- `toolsets`
- `max_iterations`
- `completed`
- `api_calls`
- `duration_seconds`
- `final_response`
- `loop_exit_reason`
- `remote_url`
- `agent_card_name`

For `a2a` mode:
- `toolsets` should be returned as `null`
- `max_iterations` should be returned as `null`

This makes the result explicit that these fields do not apply remotely.

### 8. Remote Loop Semantics

Remote loop semantics should match the current local child loop behavior:

- first turn uses `goal`
- later turns use `input.read_line()`
- `/main` and `/exit` both end the child loop and return control to the main session
- `input is None` in loop mode is a tool error
- `is_delegate_output=true` emits `delegate.*` events through the existing output adapter

The important additional rule is remote continuity:

- one `delegate_ext(agent="a2a", is_loop=true)` call should reuse one remote A2A task/context across all child turns
- the implementation must not create a fresh remote task for every user line

This preserves the same mental model as local delegated loops and keeps the remote conversation coherent.

### 9. Error Handling

#### `a2a_list`

- missing `a2a.json`
  - return `success=true`, `count=0`, `agents=[]`
- malformed `a2a.json`
  - return `success=false` with `error`
- one agent-card fetch fails
  - keep that entry and report `available=false` plus `error`

#### `delegate_ext(agent="a2a")`

- missing `a2a_name`
  - tool error
- unknown `a2a_name`
  - refresh once, then tool error with available names
- known broken registry entry
  - tool error using the stored registry error
- remote send failure
  - return `success=false`, `loop_exit_reason="error"`, and `error`
  - emit `delegate.error` when output streaming is enabled
- loop input closes after at least one successful remote turn
  - return `loop_exit_reason="input_closed"` and keep the last response

### 10. Testing Strategy

Add focused tests in [tests/tools/test_delegate_ext.py](/Users/guisheng.guo/.hermes/hermes-agent/tests/tools/test_delegate_ext.py):

- `a2a_list` reads profile-local `a2a.json`
- `a2a_list` returns structured capability data from a fetched card
- `a2a_list` preserves broken entries with `error`
- malformed `a2a.json` fails
- `delegate_ext(agent="a2a")` requires `a2a_name`
- `delegate_ext(agent="a2a")` ignores `toolsets` and `max_iterations`
- remote loop mode reuses one remote task/context across turns
- `/main` and `/exit` behave the same in remote loop mode
- result envelope includes `agent_card_name`

Prefer mocked A2A client behavior over real network tests for this feature. The goal is to validate contract and state handling, not end-to-end remote infrastructure.

## Pitfalls

- Do not silently drop broken registry entries from `a2a_list`; the user explicitly wants them preserved with error information.
- Do not let `toolsets` or `max_iterations` affect remote behavior. They are local-only settings.
- Do not create a new remote A2A task for every loop turn when `is_loop=true`.
- Do not expose `delegate_ext` recursively in local child agents; preserve the existing child capability stripping behavior.
- Do not make a missing `a2a.json` fatal; that would make the discovery tool noisy in unconfigured profiles.

## Verification

Before implementation is considered complete, the following should pass:

```bash
pytest tests/tools/test_delegate_ext.py -k "a2a_list or delegate_ext"
```

And the spec should remain aligned with:
- current local `delegate_ext` behavior
- current extcli child-loop control flow
- current AISOC A2A agent-card path convention
