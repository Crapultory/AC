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

Set `AEGIS_SESSION_TOKEN` before starting the server to use a stable bearer
token:

```bash
export AEGIS_SESSION_TOKEN="replace-me"
python aegis/backend/main.py
```

Protected endpoints expect:

```text
Authorization: Bearer <AEGIS_SESSION_TOKEN>
```

If `AEGIS_SESSION_TOKEN` is not set, the backend generates a token for that
process and prints it on startup.

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
routing rules as an array.

## API Surface In Scope

The standalone backend currently supports these API areas:

- Auth and session: `/api/auth/login`, `/api/auth/session`, `/api/auth/logout`
- System: `/health`, `/api/system/bootstrap`
- Agents: `/api/agents`, `/api/agents/{agent_id}`
- Global routing: `/api/routing/global`, `/api/routing/global/{rule_id}`

Interactive docs are available at:

```text
http://127.0.0.1:9130/docs
```

## Manual Smoke Checks

After startup, do a quick sanity check:

- Confirm startup prints the token source. With `AEGIS_SESSION_TOKEN` set, the
  server prints that it is using `AEGIS_SESSION_TOKEN`.
- Check `GET /health` returns `{"status":"ok"}`.
- Open `http://127.0.0.1:9130/docs` and confirm Swagger UI loads and exposes
  bearer auth through the `Authorize` button.
- Call a protected endpoint such as `GET /api/agents` without an
  `Authorization` header and confirm it returns `401`.
