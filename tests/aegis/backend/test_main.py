from __future__ import annotations

import argparse
import importlib
import importlib.util
import json

import pytest
from fastapi.testclient import TestClient


def _load_backend_main():
    spec = importlib.util.find_spec("aegis.backend.main")
    assert spec is not None, "aegis.backend.main should exist"
    return importlib.import_module("aegis.backend.main")


def _ns(**kwargs) -> argparse.Namespace:
    defaults = dict(
        port=9130,
        host="127.0.0.1",
        no_open=False,
        insecure=False,
    )
    defaults.update(kwargs)
    return argparse.Namespace(**defaults)


def test_backend_main_module_exists() -> None:
    _load_backend_main()


def test_build_parser_defaults_to_standalone_port() -> None:
    backend_main = _load_backend_main()

    parser = backend_main.build_parser()
    args = parser.parse_args([])

    assert args.port == 9130
    assert args.host == "127.0.0.1"


def test_cmd_aegis_dispatches_server_start(monkeypatch: pytest.MonkeyPatch) -> None:
    backend_main = _load_backend_main()
    called: dict[str, object] = {}

    def _fake_start_server(**kwargs) -> None:
        called.update(kwargs)

    monkeypatch.setattr("aegis.backend.server.start_server", _fake_start_server)

    backend_main.cmd_aegis(_ns(port=9135, host="0.0.0.0", no_open=True, insecure=True))

    assert called == {
        "host": "0.0.0.0",
        "port": 9135,
        "open_browser": False,
        "allow_public": True,
    }


def test_main_invokes_cmd_aegis(monkeypatch: pytest.MonkeyPatch) -> None:
    backend_main = _load_backend_main()
    called: dict[str, object] = {}

    def _fake_cmd_aegis(args: argparse.Namespace) -> None:
        called["port"] = args.port
        called["host"] = args.host

    monkeypatch.setattr(backend_main, "cmd_aegis", _fake_cmd_aegis)

    exit_code = backend_main.main(["--port", "9137", "--host", "127.0.0.1"])

    assert exit_code == 0
    assert called == {"port": 9137, "host": "127.0.0.1"}


def test_start_server_formats_ipv6_browser_url(monkeypatch: pytest.MonkeyPatch) -> None:
    backend_server = importlib.import_module("aegis.backend.server")
    opened: dict[str, object] = {}

    monkeypatch.setattr(backend_server, "create_app", lambda settings: object())
    monkeypatch.setattr(
        backend_server,
        "load_aegis_settings",
        lambda **kwargs: backend_server.AegisSettings(**kwargs, session_token="token"),
    )
    monkeypatch.setattr(
        backend_server.webbrowser,
        "open",
        lambda url: opened.setdefault("url", url),
    )
    monkeypatch.setattr(
        backend_server.uvicorn,
        "run",
        lambda app, host, port, log_level, proxy_headers: opened.update(
            {"host": host, "port": port}
        ),
    )

    backend_server.start_server(host="::1", port=9130, open_browser=True)

    assert opened["url"] == "http://[::1]:9130/docs"


def test_create_app_keeps_public_endpoints_available_when_store_is_invalid(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("AEGIS_SESSION_TOKEN", "test-session-token")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "a2a.json").write_text(json.dumps({"a2a": [], "global": []}))

    backend_server = load_backend("aegis.backend.server")
    app = backend_server.create_app()

    with TestClient(app) as client:
        health_response = client.get("/health")
        assert health_response.status_code == 200
        assert health_response.json() == {"status": "ok"}

        session_response = client.get("/api/auth/session")
        assert session_response.status_code == 200
        assert session_response.json() == {
            "authenticated": False,
            "token_source": "env",
        }

    with TestClient(app, raise_server_exceptions=False) as client:
        protected_response = client.get(
            "/api/agents",
            headers={"Authorization": "Bearer test-session-token"},
        )
        assert protected_response.status_code == 500
