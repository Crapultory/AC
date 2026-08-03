# Aegis Backend

The standalone Aegis backend is a small FastAPI service that exposes the Aegis
management APIs without depending on the frontend dev server. It is the local,
file-backed backend for agent registration and global routing rule management.

## Start The Server

Run the backend directly from the repo root:

```bash
source .venv/bin/activate
python aegis/backend/main.py
```

Or use the Hermes entrypoint:

```bash
hermes aegis
```

### Hermes home

On startup, Aegis binds `HERMES_HOME` to the Hermes home directory of the
agent/profile that launched it. It also uses that directory as the process
working directory and sets `HOME` to `<HERMES_HOME>/home`, matching AISOC's
runtime isolation. This keeps Aegis data, configuration, sessions, skills,
and A2A registry scoped to the launching agent instead of the shell's current
directory.

Use a Hermes profile to select that agent home:

```bash
hermes -p incident-response aegis
```

For direct Python startup, pass the same profile explicitly:

```bash
python aegis/backend/main.py --profile incident-response
```

For a custom agent home, set `HERMES_HOME` before launching:

```bash
export HERMES_HOME="/path/to/agent-home"
hermes aegis
```

The selected home is printed at startup as `Using Hermes home: …`.

Default bind settings:

- Host: `127.0.0.1`
- Port: `9130`

Useful flags:

```bash
python aegis/backend/main.py --host 127.0.0.1 --port 9130
python aegis/backend/main.py --no-open
python aegis/backend/main.py --host 0.0.0.0 --port 9130 --insecure
```

The last form intentionally exposes the API on the network and requires
`--insecure`.

## Authentication

The backend now uses username/password login plus JWT bearer auth for API and
WebSocket access.

Optional environment:

```bash
export AEGIS_JWT_SECRET="replace-me-with-a-long-random-secret"
python aegis/backend/main.py
```

Initial admin bootstrap:

```bash
export AEGIS_BOOTSTRAP_ADMIN_PASSWORD="choose-a-strong-password"
hermes aegis
```

The first `admin` account is created only when this secret is present. If it
is missing, `/api/system/bootstrap` reports that setup is required and login
remains rejected; there is no anonymous admin registration or fixed default
password.

Login response returns an access token. Protected endpoints expect:

```text
Authorization: Bearer <jwt_access_token>
```

The frontend login page also uses the same JWT for `/api/chat/ws?token=...`.

## Storage

The backend persists its state in:

```text
<HERMES_HOME>/a2a.json
```

The file-backed store uses this shape:

```json
{
  "a2a": {},
  "global": []
}
```

`a2a` stores agent definitions keyed by agent ID. `global` stores global
routing rules as an array. Agent URLs are persisted as normalized HTTP URLs;
legacy entries without a scheme such as `127.0.0.1:9086/a2a` are accepted and
served back as `http://127.0.0.1:9086/a2a`.

## API Surface In Scope

The standalone backend currently supports these API areas:

- Auth and session: `/api/auth/login`, `/api/auth/register`, `/api/auth/session`, `/api/auth/logout`, `/api/auth/password`
- User management: `/api/users`, `/api/users/{uid}/status`, `/api/users/{uid}/password`, `/api/users/{uid}`
- System: `/health`, `/api/system/bootstrap`
- Overview: `/api/overview/agents`, `/api/overview/stats`
- Agents: `/api/agents`, `/api/agents/{agent_id}`
- Global routing: `/api/routing/global`, `/api/routing/global/{rule_id}`

## Recent Chat Updates

The Aegis chat websocket endpoint at `/api/chat/ws` now includes a small set of
Aegis-native slash commands that are handled directly in the backend and return
through the normal `message.completed` event flow:

- `/help` — list the Aegis-native slash commands currently supported by the
  backend.
- `/model <model_name>` — switch the current live session agent to a new model
  without recreating the session. The override is in-memory only. If the target
  provider matches the current one and the resolved switch result omits runtime
  credentials, Aegis preserves the live agent's existing `api_key`,
  `base_url`, and `api_mode` so the session does not lose authentication.
- `/a2a` — return the current `A2A_CONTEXT` XML. If the cache is empty, the
  backend refreshes it by calling `a2a_list()` first.

Agent creation in Aegis also now uses the `tools.a2a_delegate_tool.A2A_CONTEXT`
module global directly for the ephemeral system prompt. When the cache is
empty, Aegis refreshes it with `a2a_list()` and then injects the refreshed XML.

`message.send` optionally accepts an `args` JSON object. Aegis expands shortcut
tokens first, then substitutes every matching `{key}` in the resulting prompt
with the corresponding `args[key]` value. Variables without an `args` value are
left intact, including unresolved variables in Agent shortcuts. For example:

```json
{
  "type": "message.send",
  "text": "@[prompt_incident] Review {indicator}.",
  "args": {"indicator": "example.com"}
}
```

Interactive docs are available at:

```text
http://127.0.0.1:9130/docs
```

The hosted frontend login page is available at:

```text
http://127.0.0.1:9130/login
```

`hermes aegis` automatically builds `aegis/frontend` when the source files are
newer than `aegis/backend/web_dist`. Use `--skip-build` only when the dist has
already been prepared.

## Manual Smoke Checks

After startup, do a quick sanity check:

- Set `AEGIS_BOOTSTRAP_ADMIN_PASSWORD` before the first startup, then sign in
  at `http://127.0.0.1:9130/login` with `admin` and that chosen password.
- Check `GET /health` returns `{"status":"ok"}`.
- Open `http://127.0.0.1:9130/docs` and confirm Swagger UI loads and exposes
  bearer auth through the `Authorize` button.
- Call a protected endpoint such as `GET /api/agents` without an
  `Authorization` header and confirm it returns `401`.
