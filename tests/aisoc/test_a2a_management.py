from __future__ import annotations

import os
import re
import shutil
import subprocess

import httpx
import pytest

import hermes_self_restart
from aisoc.backend import a2a_server
from aisoc.backend.config import load_aisoc_settings


_NODE_PAGE_HARNESS = r"""
const vm = require("node:vm");

class FakeElement {
  constructor({ disabled = false } = {}) {
    this.disabled = disabled;
    this.value = "";
    this.textContent = "";
    this.listeners = new Map();
  }
  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }
  async click() {
    const listener = this.listeners.get("click");
    if (listener) await listener();
  }
}

const elements = {
  "admin-token": new FakeElement(),
  "login-button": new FakeElement(),
  "restart-button": new FakeElement({ disabled: true }),
  "status": new FakeElement(),
};
const document = {
  getElementById(id) { return elements[id]; },
};
Object.defineProperty(document, "cookie", {
  get() { throw new Error("page accessed cookies"); },
  set() { throw new Error("page wrote cookies"); },
});
Object.defineProperty(globalThis, "localStorage", {
  get() { throw new Error("page accessed localStorage"); },
});
Object.defineProperty(globalThis, "sessionStorage", {
  get() { throw new Error("page accessed sessionStorage"); },
});

const calls = [];
const timers = [];
const authTokens = [];
const healthPids = [4100, 4200];
let authAttempt = 0;
let restartRequests = 0;
let reloads = 0;
let confirmResult = false;
let promptResult = "";

function response(ok, status, payload) {
  return { ok, status, async json() { return payload; } };
}

globalThis.document = document;
globalThis.window = {
  confirm() { calls.push("confirm"); return confirmResult; },
  prompt() { calls.push("prompt"); return promptResult; },
  location: { reload() { calls.push("reload"); reloads += 1; } },
};
globalThis.setTimeout = (callback) => {
  timers.push(callback);
  return timers.length;
};
globalThis.fetch = async (url, options = {}) => {
  calls.push(url);
  if (url === "/man/api/auth") {
    authAttempt += 1;
    authTokens.push(JSON.parse(options.body).token);
    if (authAttempt <= 2) return response(false, 401, { detail: "Unauthorized" });
    return response(true, 200, {
      access_token: "issued-management-access",
      expires_in: 300,
    });
  }
  if (url === "/man/api/restart") {
    restartRequests += 1;
    if (options.headers.Authorization !== "Bearer issued-management-access") {
      throw new Error("restart did not use the issued in-memory bearer");
    }
    return response(true, 202, { pid: 4100 });
  }
  if (url === "/health") {
    const pid = healthPids.shift();
    calls.push(`health:${pid}`);
    return response(true, 200, { status: "ok", module: "a2a", pid });
  }
  throw new Error(`unexpected fetch: ${url}`);
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

(async () => {
  const script = require("node:fs").readFileSync(0, "utf8");
  vm.runInThisContext(script, { filename: "a2a-management-page.js" });

  const adminToken = elements["admin-token"];
  const loginButton = elements["login-button"];
  const restartButton = elements["restart-button"];

  assert(restartButton.disabled, "restart must start disabled");
  await restartButton.click();
  assert(restartRequests === 0, "disabled restart must not issue a request");

  adminToken.value = "communication-token";
  await loginButton.click();
  assert(restartButton.disabled, "communication token must not unlock restart");

  adminToken.value = "wrong-token";
  await loginButton.click();
  assert(restartButton.disabled, "wrong token must not unlock restart");

  adminToken.value = "admin-token";
  await loginButton.click();
  assert(!restartButton.disabled, "successful auth must unlock restart");
  assert(
    JSON.stringify(authTokens) === JSON.stringify([
      "communication-token", "wrong-token", "admin-token"
    ]),
    "auth attempts did not carry the expected ephemeral input values"
  );

  confirmResult = false;
  await restartButton.click();
  assert(restartRequests === 0, "danger confirmation cancellation requested restart");

  confirmResult = true;
  promptResult = "restart a2a";
  await restartButton.click();
  assert(restartRequests === 0, "wrong exact phrase requested restart");

  promptResult = "RESTART A2A";
  await restartButton.click();
  await flushMicrotasks();
  assert(restartRequests === 1, "exact phrase did not request restart once");
  assert(restartButton.disabled, "restart control was not disabled after 202");
  assert(loginButton.disabled, "login control was not disabled after 202");
  assert(adminToken.disabled, "token input was not disabled after 202");
  assert(reloads === 0, "old process pid triggered a reload");
  assert(timers.length === 1, "old process pid did not schedule another health poll");

  timers.shift()();
  await flushMicrotasks();
  assert(reloads === 1, "new process pid did not trigger one reload");
  assert(calls.filter(call => call === "reload").length === 1, "page reloaded more than once");

  process.stdout.write(JSON.stringify({ authTokens, restartRequests, reloads, calls }));
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
"""


@pytest.fixture(autouse=True)
def reset_restart_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hermes_self_restart, "_restart_requested", False)


def _settings(monkeypatch: pytest.MonkeyPatch, *, admin_token: str = ""):
    if admin_token:
        monkeypatch.setenv("AISOC_A2A_ADMIN_TOKEN", admin_token)
    else:
        monkeypatch.delenv("AISOC_A2A_ADMIN_TOKEN", raising=False)
    return load_aisoc_settings(host="127.0.0.1", port=9086, open_browser=False)


async def _client(settings) -> httpx.AsyncClient:
    app = a2a_server.create_a2a_app(settings, agent_factory=lambda _session_id: None)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    )


def test_config_loads_independent_a2a_admin_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AISOC_A2A_AUTH", "true")
    monkeypatch.setenv("A2A_SESSION_TOKEN", "communication-token")
    monkeypatch.setenv("AISOC_A2A_ADMIN_TOKEN", "  management-token  ")

    settings = load_aisoc_settings(open_browser=False)

    assert settings.a2a_session_token == "communication-token"
    assert settings.a2a_admin_token == "management-token"


def test_blank_a2a_admin_token_disables_management(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AISOC_A2A_ADMIN_TOKEN", "   ")

    settings = load_aisoc_settings(open_browser=False)

    assert settings.a2a_admin_token == ""


@pytest.mark.asyncio
async def test_management_disabled_page_and_apis_are_explicitly_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with await _client(_settings(monkeypatch)) as client:
        page = await client.get("/man")
        auth = await client.post("/man/api/auth", json={"token": "anything"})
        restart = await client.post("/man/api/restart")

    assert page.status_code == 200
    assert "management is not enabled" in page.text.lower()
    assert "restart is unavailable" in page.text.lower()
    assert auth.status_code == 503
    assert auth.json()["detail"] == "A2A management is not enabled"
    assert restart.status_code == 503
    assert restart.json()["detail"] == "A2A management is not enabled"


@pytest.mark.asyncio
async def test_management_auth_accepts_only_admin_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AISOC_A2A_AUTH", "true")
    monkeypatch.setenv("A2A_SESSION_TOKEN", "communication-token")
    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        communication = await client.post(
            "/man/api/auth", json={"token": "communication-token"}
        )
        wrong = await client.post("/man/api/auth", json={"token": "wrong"})
        accepted = await client.post("/man/api/auth", json={"token": "admin-token"})

    assert communication.status_code == 401
    assert wrong.status_code == 401
    assert accepted.status_code == 200
    payload = accepted.json()
    assert payload["access_token"]
    assert payload["access_token"] not in {"admin-token", "communication-token"}
    assert payload["token_type"] == "bearer"
    assert 0 < payload["expires_in"] <= 600


@pytest.mark.asyncio
async def test_management_auth_rejects_communication_token_even_if_values_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AISOC_A2A_AUTH", "true")
    monkeypatch.setenv("A2A_SESSION_TOKEN", "shared-by-mistake")

    async with await _client(
        _settings(monkeypatch, admin_token="shared-by-mistake")
    ) as client:
        response = await client.post(
            "/man/api/auth",
            json={"token": "shared-by-mistake"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_issued_management_bearer_authorizes_restart_and_duplicate_is_guarded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    launched = []
    shutdowns = []
    monkeypatch.setattr(
        hermes_self_restart,
        "_start_detached_watcher",
        lambda spec: launched.append(spec),
    )
    monkeypatch.setattr(
        a2a_server,
        "_graceful_shutdown",
        lambda: shutdowns.append("a2a"),
        raising=False,
    )

    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        auth = await client.post("/man/api/auth", json={"token": "admin-token"})
        headers = {"Authorization": f"Bearer {auth.json()['access_token']}"}
        first = await client.post("/man/api/restart", headers=headers)
        duplicate = await client.post("/man/api/restart", headers=headers)

    assert first.status_code == 202
    assert first.json() == {
        "accepted": True,
        "already_requested": False,
        "service": "aisoc-a2a",
        "pid": os.getpid(),
    }
    assert duplicate.status_code == 202
    assert duplicate.json() == {
        "accepted": False,
        "already_requested": True,
        "service": "aisoc-a2a",
        "pid": os.getpid(),
    }
    assert len(launched) == 1
    assert shutdowns == ["a2a"]


@pytest.mark.asyncio
async def test_restart_sends_response_body_before_graceful_shutdown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    monkeypatch.setattr(
        hermes_self_restart,
        "_start_detached_watcher",
        lambda _spec: events.append("watcher"),
    )
    monkeypatch.setattr(
        a2a_server,
        "_graceful_shutdown",
        lambda: events.append("shutdown"),
    )
    app = a2a_server.create_a2a_app(
        _settings(monkeypatch, admin_token="admin-token"),
        agent_factory=lambda _session_id: None,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        auth = await client.post("/man/api/auth", json={"token": "admin-token"})
    access_token = auth.json()["access_token"]

    request_delivered = False

    async def receive() -> dict[str, object]:
        nonlocal request_delivered
        if not request_delivered:
            request_delivered = True
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: dict[str, object]) -> None:
        message_type = str(message["type"])
        events.append(message_type)
        if message_type == "http.response.body" and not message.get("more_body", False):
            events.append("response-complete")

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/man/api/restart",
            "raw_path": b"/man/api/restart",
            "query_string": b"",
            "root_path": "",
            "headers": [(b"authorization", f"Bearer {access_token}".encode())],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
        },
        receive,
        send,
    )

    assert events.index("response-complete") < events.index("shutdown")


@pytest.mark.asyncio
async def test_restart_rejects_raw_admin_communication_invalid_and_expired_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monotonic_now = [1_000.0]
    launched = []
    monkeypatch.setattr(
        a2a_server.time,
        "monotonic",
        lambda: monotonic_now[0],
        raising=False,
    )
    monkeypatch.setattr(
        hermes_self_restart,
        "_start_detached_watcher",
        lambda spec: launched.append(spec),
    )
    monkeypatch.setattr(a2a_server, "_graceful_shutdown", lambda: None)
    monkeypatch.setenv("AISOC_A2A_AUTH", "true")
    monkeypatch.setenv("A2A_SESSION_TOKEN", "communication-token")

    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        auth = await client.post("/man/api/auth", json={"token": "admin-token"})
        access_token = auth.json()["access_token"]
        for token in ("admin-token", "communication-token", "invalid"):
            response = await client.post(
                "/man/api/restart",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert response.status_code == 401

        monotonic_now[0] += auth.json()["expires_in"] + 1
        expired = await client.post(
            "/man/api/restart",
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert expired.status_code == 401
    assert launched == []


@pytest.mark.asyncio
async def test_management_bearer_expires_despite_wall_clock_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wall_now = [10_000.0]
    monotonic_now = [500.0]
    launched = []
    monkeypatch.setattr(a2a_server.time, "time", lambda: wall_now[0])
    monkeypatch.setattr(a2a_server.time, "monotonic", lambda: monotonic_now[0])
    monkeypatch.setattr(
        hermes_self_restart,
        "_start_detached_watcher",
        lambda spec: launched.append(spec),
    )
    monkeypatch.setattr(a2a_server, "_graceful_shutdown", lambda: None)

    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        auth = await client.post("/man/api/auth", json={"token": "admin-token"})
        access_token = auth.json()["access_token"]
        wall_now[0] -= 9_000
        monotonic_now[0] += auth.json()["expires_in"] + 1
        expired = await client.post(
            "/man/api/restart",
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert expired.status_code == 401
    assert launched == []


@pytest.mark.asyncio
async def test_management_routes_bypass_communication_auth_but_keep_own_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AISOC_A2A_AUTH", "true")
    monkeypatch.setenv("A2A_SESSION_TOKEN", "communication-token")

    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        page = await client.get("/man")
        management_auth = await client.post(
            "/man/api/auth", json={"token": "admin-token"}
        )
        communication_route = await client.post(a2a_server.A2A_RPC_PATH, json={})
        restart_with_communication_token = await client.post(
            "/man/api/restart",
            headers={"Authorization": "Bearer communication-token"},
        )

    assert page.status_code == 200
    assert management_auth.status_code == 200
    assert communication_route.status_code == 401
    assert restart_with_communication_token.status_code == 401


@pytest.mark.asyncio
async def test_management_rejects_cross_origin_auth_restart_and_preflight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    launched = []
    monkeypatch.setattr(
        hermes_self_restart,
        "_start_detached_watcher",
        lambda spec: launched.append(spec),
    )
    monkeypatch.setattr(a2a_server, "_graceful_shutdown", lambda: None)
    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        valid_auth = await client.post(
            "/man/api/auth",
            json={"token": "admin-token"},
        )
        access_token = valid_auth.json()["access_token"]
        evil_auth = await client.post(
            "/man/api/auth",
            json={"token": "admin-token"},
            headers={"Origin": "https://evil.example"},
        )
        evil_restart = await client.post(
            "/man/api/restart",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Origin": "https://evil.example",
            },
        )
        evil_preflight = await client.options(
            "/man/api/auth",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST",
            },
        )

    for response in (evil_auth, evil_restart, evil_preflight):
        assert response.status_code == 403
        assert "access-control-allow-origin" not in response.headers
    assert launched == []


@pytest.mark.asyncio
async def test_management_allows_exact_service_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        response = await client.post(
            "/man/api/auth",
            json={"token": "admin-token"},
            headers={"Origin": "http://testserver"},
        )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_a2a_rpc_nested_under_man_still_requires_communication_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AISOC_A2A_AUTH", "true")
    monkeypatch.setenv("A2A_SESSION_TOKEN", "communication-token")
    monkeypatch.setattr(a2a_server, "A2A_RPC_PATH", "/man/a2a")
    settings = _settings(monkeypatch, admin_token="admin-token")

    async with await _client(settings) as client:
        response = await client.post("/man/a2a", json={})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_health_exposes_current_pid_with_existing_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with await _client(_settings(monkeypatch)) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "module": "a2a", "pid": os.getpid()}


@pytest.mark.asyncio
async def test_management_page_has_memory_only_two_stage_restart_recovery_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        response = await client.get("/man")

    html = response.text
    assert 'id="admin-token"' in html
    assert 'id="restart-button"' in html
    assert "disabled" in html
    assert "RESTART A2A" in html
    assert "window.confirm" in html
    assert "window.prompt" in html
    assert "phrase !== RESTART_PHRASE" in html
    assert "let accessToken" in html
    assert "localStorage" not in html
    assert "sessionStorage" not in html
    assert "document.cookie" not in html
    assert 'fetch("/health"' in html
    assert "health.pid !== oldPid" in html
    assert "sawDowntime" in html
    assert "window.location.reload()" in html
    assert "restartButton.disabled = true" in html


@pytest.mark.asyncio
async def test_management_page_uses_per_response_nonce_and_hardening_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with await _client(_settings(monkeypatch, admin_token="admin-token")) as client:
        first = await client.get("/man")
        second = await client.get("/man")

    nonces = []
    for response in (first, second):
        style_nonce = re.search(r'<style nonce="([^"]+)">', response.text)
        script_nonce = re.search(r'<script nonce="([^"]+)">', response.text)
        assert style_nonce is not None
        assert script_nonce is not None
        assert style_nonce.group(1) == script_nonce.group(1)
        nonce = style_nonce.group(1)
        nonces.append(nonce)
        csp = response.headers["content-security-policy"]
        assert "default-src 'none'" in csp
        assert f"style-src 'nonce-{nonce}'" in csp
        assert f"script-src 'nonce-{nonce}'" in csp
        assert "connect-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp
        assert "base-uri 'none'" in csp
        assert "form-action 'none'" in csp
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["cache-control"] == "no-store"

    assert nonces[0] != nonces[1]


def test_management_page_executes_guarded_restart_and_pid_recovery_flow() -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is unavailable; static management page contract remains covered")

    html = a2a_server._management_page(enabled=True, nonce="test-nonce")
    match = re.search(r"<script[^>]*>(.*?)</script>", html, flags=re.DOTALL)
    assert match is not None

    completed = subprocess.run(
        [node, "-e", _NODE_PAGE_HARNESS],
        input=match.group(1),
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert '"restartRequests":1' in completed.stdout
    assert '"reloads":1' in completed.stdout
