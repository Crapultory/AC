# AISOC MVP Design

Date: 2026-05-26
Status: Draft approved in conversation, written for review
Owners: User + Codex

## Overview

This spec defines the MVP for a new `hermes aisoc` command. AISOC is a
standalone product surface, not a rename of Hermes Dashboard. It should feel
like an independent operations console while reusing stable Hermes runtime
capabilities where that reduces risk and implementation time.

The MVP includes:

- `hermes aisoc` CLI command
- dedicated backend under `aisoc/backend/`
- dedicated React frontend under `aisoc/frontend/`
- modules:
  - `chat-tui` (reused runtime)
  - `sessions` with relaunch into chat
  - `cron`
  - `skills`
  - `memory`
  - `logs`

The MVP explicitly does not include:

- config editor
- profiles UI
- analytics
- plugin marketplace
- docs hosting
- alternative chat runtime
- multi-user auth or role-based access control

## Goals

- Ship an AISOC-specific command and web app with a clear product boundary.
- Reuse Hermes runtime primitives instead of reimplementing chat behavior.
- Keep the CLI contract familiar by mirroring `hermes dashboard` flags.
- Support explicit login from the browser instead of auto-injected page tokens.
- Expose a memory management module that edits real files:
  - `SOUL.md`
  - `USER.md`
  - built-in memory files

## Non-Goals

- Building a generic admin platform for every Hermes feature
- Refactoring dashboard and AISOC onto a shared framework before MVP
- Supporting external memory provider content editing in MVP
- Designing a full security product brand system in MVP

## Product Shape

AISOC is a standalone local-first web application served by a single backend
process started via `hermes aisoc`. It uses a dedicated backend and frontend,
but selectively reuses stable Hermes internals:

- PTY-backed TUI embedding for chat
- session database access
- cron management helpers
- skills discovery/toggle helpers
- log access utilities

AISOC is not allowed to depend on Dashboard page code at runtime. Code reuse is
permitted at the service/helper level, but the AISOC frontend and backend entry
points must remain independent.

## CLI Contract

The `hermes aisoc` command mirrors the current `hermes dashboard` contract,
with a different default port.

Supported flags:

- `--port` default `9120`
- `--host` default `127.0.0.1`
- `--no-open`
- `--insecure`
- `--tui`
- `--skip-build`
- `--stop`
- `--status`

Behavior:

- `--tui` enables the embedded chat tab and related websocket surfaces.
- `--stop` and `--status` follow the same lifecycle semantics as dashboard.
- `--insecure` is required for non-loopback binding.

## Repository Layout

```text
aisoc/
  backend/
    __init__.py
    server.py
    auth.py
    config.py
    models.py
    routes/
      auth.py
      chat.py
      sessions.py
      cron.py
      skills.py
      memory.py
      logs.py
      system.py
    services/
      tui_embed.py
      session_service.py
      cron_service.py
      skill_service.py
      memory_service.py
      log_service.py
  frontend/
    package.json
    src/
      main.tsx
      App.tsx
      auth/
      pages/
      components/
      lib/
```

Build output should mirror the dashboard pattern and end up in a backend-served
static directory such as `aisoc/backend/web_dist/`.

## Backend Architecture

### Framework

Use FastAPI for MVP. This matches existing Hermes operational patterns and
supports:

- static asset serving
- REST APIs
- websocket endpoints
- PTY-backed chat transport

### Process Model

`hermes aisoc` starts a single backend process that:

- initializes auth configuration
- serves static frontend assets
- mounts AISOC REST and websocket routes
- exposes embedded chat endpoints only when `--tui` is enabled

Development may use split frontend/backend dev servers, but the shipped product
shape remains a single command, single service entrypoint.

### Auth Model

AISOC does not inject a usable session token into HTML. Instead it uses an
explicit login flow.

Token source:

1. If `AISOC_SESSION_TOKEN` is present, use it as the static login token.
2. Otherwise, generate a random token at process start and print it to local
   console/log output for the operator.

Browser flow:

1. User lands on login page.
2. User enters token.
3. Frontend calls `POST /api/auth/login`.
4. Backend validates token.
5. Frontend stores token in browser local storage.
6. Protected REST and websocket requests send the token explicitly.

Implications:

- No protected API works before login.
- Page HTML does not expose an auto-usable credential.
- Restarting the service invalidates browser login when a dynamic token was in
  use.

### Route Organization

Routes are grouped by feature:

- `/api/auth/*`
- `/api/system/*`
- `/api/chat/*`
- `/api/sessions/*`
- `/api/cron/*`
- `/api/skills/*`
- `/api/memory/*`
- `/api/logs/*`

Each route module should remain thin and call feature services in
`aisoc/backend/services/`.

### Public vs Protected Endpoints

Public endpoints should stay minimal:

- `POST /api/auth/login`
- `GET /api/auth/session`
- `GET /health`

Everything else is protected by auth middleware.

### Security Model

Keep dashboard-grade local safety defaults:

- default bind `127.0.0.1`
- non-loopback requires `--insecure`
- host header validation for loopback bindings
- restrictive CORS defaults
- no token injection into HTML

## Chat-TUI Reuse

### Reuse Strategy

AISOC reuses the real TUI runtime rather than rebuilding chat UI logic in React.

The backend should continue the proven chain:

- browser xterm.js terminal
- websocket to PTY bridge
- PTY child running real `hermes --tui`
- `tui_gateway` for structured events and controls

### AISOC Chat Endpoints

Under `--tui`, AISOC should expose equivalents of:

- `/api/chat/pty`
- `/api/chat/ws`
- `/api/chat/pub`
- `/api/chat/events`

The path prefix changes from dashboard style to AISOC style, but the behavior
remains consistent.

### Why Reuse

This preserves:

- slash command behavior
- prompt handling
- approval/clarify/sudo/secret flows
- session resume behavior
- tool progress events

It also avoids creating a second chat implementation that would drift from the
terminal TUI.

## Frontend Architecture

### Framework

Use a standalone React app, following the existing Hermes web stack style:

- React
- React Router
- TypeScript
- Vite

The AISOC frontend does not import dashboard pages or share the same app shell
at runtime.

### Core App Structure

Top-level pages:

- `/login`
- `/chat`
- `/sessions`
- `/cron`
- `/skills`
- `/memory`
- `/logs`

The app should have:

- auth guard
- shared shell/navigation
- feature pages
- a small client library for REST and websocket auth

### Login UX

The browser starts at a login page when no valid token is cached.

Requirements:

- token input field
- login submit action
- clear invalid-token errors
- logout action that clears local storage and returns to `/login`

Browser cache:

- store token in local storage
- verify cached token on app bootstrap using `GET /api/auth/session`
- if invalid, clear local state and redirect to login

## Module Design

### Chat

Chat page has two layers:

- primary xterm.js surface for the real TUI
- secondary structured sidebar for model status and tool activity

The React side may borrow dashboard interaction ideas, but the core transcript
and composer remain the real TUI process.

### Sessions

Sessions page provides:

- recent sessions list
- session search
- session details
- session messages
- delete action
- relaunch action

Relaunch behavior:

- selecting relaunch routes to `/chat?resume=<session_id>`
- chat page resolves latest descendant if needed
- PTY session is recreated for the selected thread

### Cron

Cron page provides:

- list jobs
- create job
- edit supported job fields
- pause/resume
- trigger now
- delete

This should wrap existing Hermes cron primitives, not invent a new scheduler.

### Skills

Skills page provides:

- list skills
- enable/disable skill

MVP focus is basic operations, not deep skill authoring workflows.

### Memory

Memory is a content management page, not a provider picker in MVP.

It exposes three editable areas:

- `Agent Soul` backed by `SOUL.md`
- `User Preferences` backed by `USER.md`
- `Memory` backed by built-in memory files

MVP memory requirements:

- list available memory files
- open one file at a time
- edit and save
- show source path / logical source label

MVP does not include editing external provider memory stores.

### Logs

Logs page provides:

- choose log file
- choose line count
- filter by level
- filter by component
- auto-refresh / tail-like polling

It reuses the same underlying log access strategy as dashboard.

## API Sketch

### Auth

- `POST /api/auth/login`
  - request: `{ "token": "..." }`
  - response: `{ "ok": true }`
- `GET /api/auth/session`
  - validates cached token
  - response: `{ "ok": true }`
- `POST /api/auth/logout`
  - mostly client-state oriented

### Chat

- `GET /api/chat/ws?...`
- `GET /api/chat/pty?...`
- `GET /api/chat/events?...`
- `GET /api/chat/pub?...`

Token is supplied explicitly in headers or query params depending on transport.

### Sessions

- `GET /api/sessions`
- `GET /api/sessions/search`
- `GET /api/sessions/{id}`
- `GET /api/sessions/{id}/messages`
- `GET /api/sessions/{id}/latest-descendant`
- `DELETE /api/sessions/{id}`

### Cron

- `GET /api/cron/jobs`
- `GET /api/cron/jobs/{id}`
- `POST /api/cron/jobs`
- `PUT /api/cron/jobs/{id}`
- `POST /api/cron/jobs/{id}/pause`
- `POST /api/cron/jobs/{id}/resume`
- `POST /api/cron/jobs/{id}/trigger`
- `DELETE /api/cron/jobs/{id}`

### Skills

- `GET /api/skills`
- `PUT /api/skills/toggle`

### Memory

- `GET /api/memory`
  - returns summary of soul/preferences/memory files
- `GET /api/memory/document`
  - request by logical key and specific file id when the logical key is
    `memory`
- `PUT /api/memory/document`
  - saves document content

Logical keys:

- `soul`
- `preferences`
- `memory`

### Logs

- `GET /api/logs`

## Error Handling

### Auth

- invalid token returns `401`
- missing configured token source is not fatal if a dynamic token can be
  generated
- dynamic-token mode must print enough local information for the operator to
  retrieve the token

### Chat

- if PTY or TUI runtime is unavailable, only the chat page degrades
- the rest of AISOC remains usable
- websocket auth failures should surface as explicit login/session errors, not
  generic transport crashes

### Memory

- missing `SOUL.md` or `USER.md` should produce a clear recoverable response
- save failures must distinguish:
  - file missing
  - permission denied
  - concurrent modification

### General

- route handlers return stable JSON error envelopes
- frontend shows actionable messages, not raw stack traces

## Testing Strategy

### Backend

Minimum automated coverage:

- auth middleware
- login flow
- cached-session validation
- protected route rejection without auth
- chat token propagation to websocket routes
- session relaunch helper behavior
- memory document read/write for `SOUL.md`, `USER.md`, and memory file targets
- logs filtering
- cron route plumbing
- skills toggle plumbing

### Frontend

Minimum automated coverage:

- login page happy path
- invalid token handling
- cached token bootstrap
- protected route redirect to `/login`
- chat page resume query handling
- sessions relaunch action
- memory editor save flow

### Manual

Manual validation should confirm:

- `hermes aisoc --tui` opens chat successfully
- relaunch from sessions enters chat with the right session
- token persists across page refresh
- dynamic token changes after server restart

## Implementation Slices

The MVP should be planned and implemented in four workstreams:

1. CLI and boot
   - add `hermes aisoc`
   - build/start/stop/status behavior
   - frontend static serving

2. Backend foundation and auth
   - FastAPI app
   - auth middleware
   - login/session endpoints
   - shared response/error model

3. Frontend shell and auth routing
   - login page
   - app shell
   - token cache + guarded navigation

4. Feature modules
   - chat + session relaunch
   - logs
   - cron
   - skills
   - memory

Priority inside workstream 4:

1. chat + sessions relaunch
2. logs
3. cron
4. skills
5. memory

Memory remains required for MVP, but it should be implemented as a focused
document-management slice after the chat/session path is stable.

## Risks

- Copying too much dashboard code will blur product boundaries and slow future
  maintenance.
- Rewriting too much chat behavior in React would create long-term drift from
  `hermes --tui`.
- Memory file editing has a higher risk of accidental overwrite if concurrency
  and source labeling are vague.

Mitigations:

- isolate AISOC route and frontend entrypoints
- reuse the real TUI runtime
- make document source and save semantics explicit

## Open Decisions Resolved In This Spec

- AISOC is a standalone product, not a dashboard alias.
- Deployment model is single command, single backend service.
- Auth uses explicit login, not token injection.
- Token source is static env var when present, otherwise dynamic startup token.
- CLI flags mirror dashboard exactly, with default port `9120`.
- Memory maps to:
  - `SOUL.md`
  - `USER.md`
  - built-in memory files

## Acceptance Criteria

The MVP is complete when:

- `hermes aisoc` starts a web app on port `9120` by default
- login is required before entering protected pages
- `chat-tui` works under `--tui`
- sessions can relaunch into chat
- cron, skills, memory, and logs pages are reachable and functional
- memory editing works for the three specified sources
- AISOC code lives in dedicated `aisoc/backend` and `aisoc/frontend` trees
