# Aegis Backend API Design

## Summary

This design adds a new standalone `aegis/backend` FastAPI service that mirrors the structural patterns used by `aisoc/backend` while staying narrowly scoped to two configuration modules:

- `Agent Orchestration`
- `Routing Policy` global rules only

The service uses Bearer token authentication with the `AEGIS_SESSION_TOKEN` environment variable, stores all state in `get_hermes_home() / "a2a.json"`, and keeps one shared in-memory data object for both agent management and global routing management. Every successful write updates the shared object and immediately persists the file.

This design does not add Chat, Overview, Session, or frontend hosting endpoints. It does not implement Agent card rules, rule simulation, database persistence, or background workers.

## When to Use

Use this design when:

- Aegis needs its own backend service instead of piggybacking on `aisoc/backend`
- the frontend needs real CRUD APIs for agent registration and global routing rules
- the current Hermes profile should remain the single storage boundary via `HERMES_HOME/a2a.json`
- auth behavior should match AISOC closely enough that frontend login flow and operational expectations stay familiar

Do not use this design for:

- high-volume operational data that needs a database
- multi-user concurrent editing with audit trails
- advanced policy parsing, validation, prioritization, or simulation
- agent discovery beyond explicit entries in `a2a.json`

## Prerequisites

- Existing Hermes profile path resolution via [hermes_constants.py](/Users/guisheng.guo/.hermes/hermes-agent/hermes_constants.py)
- Existing AISOC backend patterns in:
  - [aisoc/backend/server.py](/Users/guisheng.guo/.hermes/hermes-agent/aisoc/backend/server.py)
  - [aisoc/backend/auth.py](/Users/guisheng.guo/.hermes/hermes-agent/aisoc/backend/auth.py)
  - [aisoc/backend/config.py](/Users/guisheng.guo/.hermes/hermes-agent/aisoc/backend/config.py)
  - [aisoc/backend/routes/auth.py](/Users/guisheng.guo/.hermes/hermes-agent/aisoc/backend/routes/auth.py)
  - [aisoc/backend/routes/system.py](/Users/guisheng.guo/.hermes/hermes-agent/aisoc/backend/routes/system.py)
- FastAPI already available in the repo runtime used for AISOC
- A writable `HERMES_HOME` directory for the active profile

## How to Run

Direct startup should follow the AISOC pattern:

```bash
python aegis/backend/main.py --host 127.0.0.1 --port 9130
```

Environment configuration:

```bash
export AEGIS_SESSION_TOKEN="your-shared-token"
```

If `AEGIS_SESSION_TOKEN` is unset, the service should generate a process-local token and print it at startup, matching AISOC behavior.

Primary file store:

```text
<HERMES_HOME>/a2a.json
```

Expected file shape:

```json
{
  "a2a": {
    "test": {
      "url": "http://127.0.0.1:9086/a2a",
      "description": "A2A test endpoint",
      "headers": {
        "Authorization": "Bearer <token>"
      },
      "status": "active",
      "extcapabilities": ["支持基于domian,ip进行情报查询"]
    }
  },
  "global": [
    {
      "id": "randomstr8",
      "name": "test1",
      "policy": "这是第一条规则",
      "status": "active"
    }
  ]
}
```

## Quick Reference

### Service Layout

- `aegis/backend/main.py`
  - CLI entrypoint
- `aegis/backend/server.py`
  - FastAPI app assembly
- `aegis/backend/config.py`
  - token loading and runtime settings
- `aegis/backend/auth.py`
  - bearer token helpers
- `aegis/backend/models.py`
  - Pydantic request and response models
- `aegis/backend/routes/auth.py`
  - login, session, logout
- `aegis/backend/routes/system.py`
  - `health` and `bootstrap`
- `aegis/backend/routes/agents.py`
  - Agent Orchestration CRUD
- `aegis/backend/routes/routing.py`
  - Global Routing Policy CRUD
- `aegis/backend/services/store.py`
  - shared file-backed registry
- `aegis/backend/services/agent_service.py`
  - operations over `a2a`
- `aegis/backend/services/routing_service.py`
  - operations over `global`

### Authentication Rules

- protect all `/api/*` endpoints by default
- public endpoints:
  - `POST /api/auth/login`
  - `GET /api/auth/session`
  - `POST /api/auth/logout`
  - `GET /health`
  - `GET /api/system/bootstrap`
- use `Authorization: Bearer <token>`

### Agent API

- `GET /api/agents`
- `GET /api/agents/{agent_id}`
- `POST /api/agents/{agent_id}`
- `PUT /api/agents/{agent_id}`
- `DELETE /api/agents/{agent_id}`

Rules:

- `agent_id` is the `a2a` object key
- request bodies must not contain `agent_id`; creation and update both take it from the path
- agent `status` only allows `active`, `idle`, or `offline`
- `PUT` updates the value under the existing path key only

### Global Routing API

- `GET /api/routing/global`
- `GET /api/routing/global/{rule_id}`
- `POST /api/routing/global`
- `PUT /api/routing/global/{rule_id}`
- `DELETE /api/routing/global/{rule_id}`

Rules:

- each rule gets an auto-generated 8-character `id`
- global rule `status` only allows `active` or `inactive`
- only global rules are supported in this phase
- no agent card rule endpoints are exposed

## Procedure

### 1. Create a Standalone Backend Package

Add a new `aegis/backend` package rather than extending `aisoc/backend`. The new service should look and feel like AISOC but have its own:

- settings object
- token environment variable
- route registry
- business services

This keeps Aegis deployable on its own and avoids coupling its evolution to AISOC internals.

### 2. Mirror AISOC Auth and App Assembly

Copy the behavioral pattern from AISOC:

- `config.py` loads settings and resolves the session token
- `auth.py` extracts and verifies bearer tokens
- `server.py` installs a middleware that protects `/api/*` except the explicit public allowlist
- Swagger/OpenAPI gets a bearer auth scheme injected so `/docs` works cleanly during local development

The only intentional auth difference is the environment variable name:

```text
AEGIS_SESSION_TOKEN
```

Everything else should stay aligned with AISOC unless Aegis later has a reason to diverge.

### 3. Use One Shared Store Object

Implement one shared store service in [aegis/backend/services/store.py](/Users/guisheng.guo/.hermes/hermes-agent/aegis/backend/services/store.py) with one in-memory object:

```python
{
    "a2a": {},
    "global": [],
}
```

Both `agent_service` and `routing_service` should depend on this same store object. They must not keep their own copies or perform direct ad hoc file writes.

Store responsibilities:

- resolve `get_hermes_home() / "a2a.json"`
- load file contents at startup or first access
- initialize a default structure when the file is missing
- validate the top-level JSON shape
- expose safe read helpers
- expose locked write helpers
- persist changes immediately after successful mutation

### 4. Define File Validation Rules

File handling must be explicit:

- missing file:
  - create default structure and save it immediately
- malformed JSON:
  - fail startup or fail store initialization loudly
- missing `a2a` or `global`:
  - insert missing keys and save normalized structure
- `a2a` not a mapping:
  - treat as invalid
- `global` not a list:
  - treat as invalid

This design intentionally rejects invalid structure instead of silently flattening or resetting it, because the file is now a source of configuration truth.

### 5. Model Agent Data Directly on `a2a`

Agent API requests and responses should map closely to the stored object value:

```json
{
  "url": "http://127.0.0.1:9086/a2a",
  "description": "A2A test endpoint",
  "headers": {
    "Authorization": "Bearer <token>"
  },
  "status": "active",
  "extcapabilities": ["支持基于domain,ip进行情报查询"]
}
```

The response for one agent should include `agent_id` derived from the path key so the frontend does not need to reconstruct it.

Creation flow:

1. route reads `{agent_id}` from the path
2. service checks that the key does not already exist
3. service inserts the object under `data["a2a"][agent_id]`
4. store persists immediately

Update flow:

1. route receives `agent_id` from the path
2. body contains only mutable fields
3. service replaces the stored value under that existing key
4. store persists immediately

`PUT` must not rename keys. If renaming is needed later, it should be a separate endpoint with explicit semantics.

### 6. Model Global Routing Rules as a List

Global policy entries stay in `data["global"]` as list objects:

```json
{
  "id": "abcd1234",
  "name": "test1",
  "policy": "这是第一条规则",
  "status": "active"
}
```

Creation flow:

1. generate an 8-character random ID
2. validate it does not collide with an existing rule ID
3. append the new rule object
4. persist immediately

Lookup and update should search by `id`. No additional indexing layer is needed at this phase because the dataset is small and file-backed.

### 7. Keep Status Semantics Explicit Per Object Type

Use separate status enums for agents and global rules.

Agent status:

- `active`
- `idle`
- `offline`

Global rule status:

- `active`
- `inactive`

This matches the intended domain behavior:

- agents expose runtime connectivity and readiness semantics
- global rules only expose enabled or disabled semantics

Frontend display labels such as `Enabled`, `Disabled`, `Active`, or `Offline` should still be handled in presentation code rather than by adding duplicate backend values.

### 8. Persist Safely

Each successful mutation must be written using atomic file replacement:

1. serialize to a temporary file in the same directory
2. flush and close
3. replace the target file

Recommended serialization:

- `ensure_ascii=False`
- `indent=2`
- trailing newline

This keeps the file human-readable and reduces the chance of corruption on interrupted writes.

### 9. Error Handling

Use standard HTTP semantics:

- `401 Unauthorized`
  - missing or incorrect bearer token
- `404 Not Found`
  - missing agent or missing rule
- `409 Conflict`
  - duplicate `agent_id`
- `422 Unprocessable Entity`
  - invalid request payload
- `500 Internal Server Error`
  - file read/write failure or unrecoverable store state

Response bodies can stay lightweight and consistent with AISOC. There is no need to introduce a heavy response envelope in this phase.

### 10. Testing Scope

Test the store and the routes separately.

Store tests:

- create default file when missing
- preserve and read valid file
- normalize missing keys
- reject malformed JSON
- reject wrong top-level types
- persist after create, update, and delete

Route tests:

- auth allowlist works
- protected routes require bearer token
- agent CRUD happy path
- duplicate agent returns `409`
- rule CRUD happy path
- missing agent or rule returns `404`

## Pitfalls

- Do not let routes mutate raw store data directly; all writes should go through services or a locked store mutation helper.
- Do not allow `POST /api/agents/{agent_id}` or `PUT /api/agents/{agent_id}` to accept a second `agent_id` in the body.
- Do not silently wipe malformed `a2a.json`; fail loudly instead.
- Do not split agents and global rules into separate files during this phase; the shared file is a deliberate requirement.
- Do not over-design with async database abstractions or repository layers beyond what the file-backed store actually needs.

## Verification

Before implementation is considered ready, verify:

- the service starts with and without `AEGIS_SESSION_TOKEN`
- `/health` and `/api/system/bootstrap` are reachable without auth
- `/api/auth/login` accepts only the correct token
- agent CRUD updates `HERMES_HOME/a2a.json`
- agent status validation rejects values outside `active`, `idle`, `offline`
- global routing CRUD updates the same file
- global rule status validation rejects values outside `active`, `inactive`
- writes are persisted immediately after each mutation
- malformed file input produces a loud, diagnosable failure

After implementation, run route-level tests plus a manual smoke check against Swagger docs to confirm the bearer auth flow matches AISOC expectations.
