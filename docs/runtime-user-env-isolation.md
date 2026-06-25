# Runtime User Environment Isolation

This document describes the current user-scoped runtime environment design for
Hermes gateway / messaging sessions.

It covers:

- identity binding for tool execution
- persistent user env storage
- `userenv` tool behavior
- local terminal runtime isolation
- lifecycle and resource characteristics
- known boundaries and compatibility behavior

## Overview

The goal of this design is:

1. Persist environment variables per messaging user.
2. Ensure users can manage only their own variables.
3. Prevent cross-user reuse during command execution.
4. Preserve stable cross-turn reuse for the same user.

The current design uses two separate keys with different purposes:

- **storage key**: `platform.user_id`
- **runtime scope key**: `local::{platform}::{user_id}`

`user_name` is no longer part of the storage partition key. Instead, it is
persisted as the reserved env variable `CURRENT_USER_NAME` inside the stored
payload for that user.

## Data Model

Persistent data lives at:

- `$HERMES_HOME/users.env.json`

Current on-disk shape:

```json
{
  "slack.u123": {
    "CURRENT_USER_NAME": "alice",
    "API_TOKEN": "secret-value",
    "FOO": "bar"
  },
  "feishu.u123": {
    "CURRENT_USER_NAME": "alice",
    "FOO": "other-platform-value"
  }
}
```

Properties:

- `platform` remains part of the storage key.
- `user_id` remains the stable partition key inside one platform.
- `user_name` is stored as `CURRENT_USER_NAME` in the value object.
- Different platforms with the same `user_id` remain isolated.

## Identity Binding

The runtime identity is carried through tool execution with `ContextVar`.

Primary implementation:

- `tools/user_env_runtime.py`
- `gateway/session_context.py`
- `agent/agent_runtime_helpers.py`
- `agent/tool_executor.py`
- `tools/thread_context.py`

The active identity is represented by `UserEnvIdentity`:

- `platform`
- `user_id`
- `user_name`
- `user_key` (storage key, `platform.user_id`)
- `runtime_scope_key` (`local::{platform}::{user_id}`)

Binding flow:

1. Gateway receives a platform event and sets per-session context values.
2. Tool execution binds the current identity with `bind_current_user_env_identity(...)`.
3. Runtime helpers read that identity via `get_current_user_env_identity()`.
4. Worker threads inherit the same context through `propagate_context_to_thread(...)`.

This is the isolation boundary for all user-scoped env reads.

## Storage Semantics

Primary implementation:

- `tools/user_env_store.py`

Key behavior:

- `make_user_env_key(platform, user_id, user_name=None)` returns `platform.user_id`.
- `load_user_env(...)` always injects `CURRENT_USER_NAME` into the returned env payload.
- `set_user_env_var(...)` always refreshes `CURRENT_USER_NAME` to the current bound name.
- `delete_user_env_var(...)` does not allow deleting `CURRENT_USER_NAME`.

### Legacy Migration

Older payloads may still use the historical key shape:

- `platform.user_id.user_name`

Current behavior on load:

1. Try the new key `platform.user_id`.
2. If missing, scan for legacy keys with prefix `platform.user_id.`.
3. If exactly one legacy match exists, migrate it in-place to the new key.
4. Persist `CURRENT_USER_NAME` into the migrated payload.
5. If multiple legacy matches exist, log a warning and do not merge ambiguously.

This keeps existing deployments readable without a one-shot migration script.

## `userenv` Tool Behavior

Primary implementation:

- `tools/userenv_tool.py`

Supported actions:

- `list`
- `set`
- `delete`

Rules:

- The tool operates only on the current authenticated runtime user.
- It never reads or mutates another user's payload.
- Tool responses mask values.
- `CURRENT_USER_NAME` is treated as a reserved system field:
  - automatically maintained in storage
  - injected into runtime env
  - excluded from `list` output
  - excluded from `count` / `remaining`

User-visible semantics therefore remain "my custom env variables", while the
system still preserves the current display name for runtime use.

## Runtime Injection Model

Primary implementation:

- `tools/user_env_runtime.py`
- `tools/environments/local.py`
- `tools/environments/base.py`

There are two different execution paths:

### 1. Direct subprocess env injection

Used by:

- local foreground command process creation
- local background process spawning

Behavior:

- `get_current_user_env_values()` loads the current user's payload.
- The subprocess env receives both custom vars and `CURRENT_USER_NAME`.

### 2. Local shell snapshot overlay

Local terminal foreground execution uses a reusable shell snapshot. This is the
path that previously caused cross-user leakage.

Current behavior:

1. `LocalEnvironment.init_session()` creates the login-shell snapshot **without**
   user env injection.
2. Before each command, the current user's env is overlaid into the shell.
3. Before snapshot persistence (`export -p > snapshot`), all user-scoped keys
   are unset.
4. Deleted keys from the previous execution are also unset before and after the
   command.

This guarantees:

- no cross-user persistence in the snapshot
- same-user updates take effect immediately
- same-user deletions take effect immediately

## Local Environment Isolation

Primary implementation:

- `tools/terminal_tool.py`

For `TERMINAL_ENV=local`, the environment cache key is no longer the global
`default` bucket when a runtime user identity exists.

Instead, local env reuse is scoped by:

- `local::{platform}::{user_id}`

Implications:

- `slack/u123` and `slack/u456` get different local env instances.
- `slack/u123` and `feishu/u123` get different local env instances.
- username changes do **not** create a new local env instance.

This affects only the local backend cache key. Container / SSH / benchmark
override semantics remain unchanged.

## Local Environment Lifecycle

Primary implementation:

- `tools/terminal_tool.py`
- `tools/environments/local.py`

### What a local env instance contains

A `LocalEnvironment` is not a long-lived shell process. It mainly holds:

- current `cwd`
- timeout / env metadata
- snapshot file path
- cwd tracking file path
- userenv cleanup bookkeeping sets

Per command, Hermes spawns a fresh `bash -c` process and reuses the snapshot.

### Creation

A local env instance is created on first use for a given runtime scope key:

- `local::{platform}::{user_id}`

The instance is cached in:

- `_active_environments`

### Reuse

The same user on the same platform reuses the same local env instance across
turns until cleanup.

### Idle Cleanup

Inactive envs are cleaned by the terminal cleanup thread.

Relevant config:

- `TERMINAL_LIFETIME_SECONDS`
- default: `300`

Behavior:

1. Cleanup thread wakes every 60 seconds.
2. If an env has been inactive longer than `lifetime_seconds`, it is removed.
3. `LocalEnvironment.cleanup()` deletes its snapshot and cwd temp files.

### Background Process Interaction

If a task has active background processes registered in `process_registry`,
cleanup refreshes its `last_activity` and keeps the env alive.

This means the effective lifetime may be much longer than the idle timeout when
background work is still associated with that task.

## Resource Characteristics

Compared to Docker / Modal / Daytona, local env isolation is relatively cheap.

Per active local user scope, Hermes keeps:

- one Python object in `_active_environments`
- one timestamp entry in `_last_activity`
- one creation lock entry
- one shell snapshot file
- one cwd tracking file

It does **not** keep:

- a dedicated long-lived shell process
- a dedicated container
- a dedicated VM

So resource growth is mostly linear with the number of active user scopes, but
the unit cost is small.

The main resource caveat is not the `LocalEnvironment` object itself. It is any
background process the user starts, because those processes can keep the env
alive and consume CPU / memory independently.

## Known Boundaries

### Reserved key

`CURRENT_USER_NAME` is a system-managed field. It is part of runtime injection
but not treated as a normal user-managed variable in `userenv` responses.

### Shell-export compatibility

The persistent store allows arbitrary env variable names except impossible
names such as keys containing `=` or NUL.

For local shell snapshot overlay specifically:

- only shell-export-safe names are injected into the shell with `export KEY=...`
- non-shell-safe keys still work for subprocess env injection paths
- those keys are not written into the shell snapshot

This preserves the product requirement of broad env support without making the
shell wrapper unsafe.

### Backend scope

The user-scoped cache key change applies only to the local terminal backend.

Other backends keep their existing reuse semantics unless they explicitly adopt
the same isolation strategy later.

## Operational Notes

When debugging user env issues, check these in order:

1. Is the runtime identity bound correctly?
2. Does `users.env.json` contain the expected `platform.user_id` record?
3. Does that record contain the expected `CURRENT_USER_NAME` and custom keys?
4. Is the command running on the local backend or another backend?
5. Is the observed value coming from a live overlay or from unrelated process state?

Useful source files:

- `tools/user_env_store.py`
- `tools/user_env_runtime.py`
- `tools/userenv_tool.py`
- `tools/terminal_tool.py`
- `tools/environments/base.py`
- `tools/environments/local.py`

## Summary

The current runtime user env design uses:

- `platform.user_id` for persistence
- `CURRENT_USER_NAME` inside the stored payload
- `local::{platform}::{user_id}` for local runtime instance isolation
- `ContextVar` for request-local identity propagation
- execution-time overlay plus snapshot cleanup for local shell reuse

This gives stable same-user reuse, avoids cross-user leakage, and keeps the
local backend lightweight enough for multi-user gateway operation.
