from __future__ import annotations

import argparse
import importlib
import importlib.util
import os

import pytest


def _load_backend_main():
    spec = importlib.util.find_spec("aisoc.backend.main")
    assert spec is not None, "aisoc.backend.main should exist as the shared AISOC entrypoint"
    return importlib.import_module("aisoc.backend.main")


def _ns(**kwargs) -> argparse.Namespace:
    defaults = dict(
        port=9120,
        host="127.0.0.1",
        no_open=False,
        insecure=False,
        tui=False,
        skip_build=False,
        stop=False,
        status=False,
        module="server",
        name=None,
        description=None,
        card=None,
        db=None,
        streaming=False,
        workers=4,
    )
    defaults.update(kwargs)
    return argparse.Namespace(**defaults)


def test_backend_main_module_exists() -> None:
    _load_backend_main()


def test_cmd_aisoc_dispatches_a2a_module(monkeypatch: pytest.MonkeyPatch) -> None:
    backend_main = _load_backend_main()
    called: dict[str, object] = {}

    def _fake_start_a2a_server(**kwargs) -> None:
        called.update(kwargs)

    monkeypatch.setattr(
        "aisoc.backend.a2a_server.start_a2a_server",
        _fake_start_a2a_server,
        raising=False,
    )
    backend_main.cmd_aisoc(
        _ns(
            module="a2a",
            port=9086,
            host="0.0.0.0",
            insecure=True,
            name="Hermes A2A",
            description="A2A server",
            card="/tmp/card.json",
            db="/tmp/a2a.db",
            streaming=True,
            workers=8,
        )
    )

    assert called == {
        "host": "0.0.0.0",
        "port": 9086,
        "allow_public": True,
        "name": "Hermes A2A",
        "description": "A2A server",
        "card_path": "/tmp/card.json",
        "db_path": "/tmp/a2a.db",
        "streaming": True,
        "workers": 8,
    }


def test_cmd_aisoc_rejects_server_only_flags_for_a2a() -> None:
    backend_main = _load_backend_main()
    with pytest.raises(SystemExit) as exc:
        backend_main.cmd_aisoc(_ns(module="a2a", tui=True))
    assert exc.value.code == 2


def test_cmd_aisoc_dispatches_extcli_module(monkeypatch: pytest.MonkeyPatch) -> None:
    backend_main = _load_backend_main()
    called: dict[str, object] = {}

    def _fake_start_extcli(**kwargs) -> None:
        called.update(kwargs)

    monkeypatch.setattr(
        "aisoc.backend.extcli.start_extcli",
        _fake_start_extcli,
        raising=False,
    )
    backend_main.cmd_aisoc(_ns(module="extcli"))

    assert called == {}


def test_cmd_aisoc_rejects_a2a_only_flags_for_extcli() -> None:
    backend_main = _load_backend_main()
    with pytest.raises(SystemExit) as exc:
        backend_main.cmd_aisoc(_ns(module="extcli", streaming=True))
    assert exc.value.code == 2


def test_main_applies_profile_override_before_dispatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend_main = _load_backend_main()
    called: dict[str, object] = {}

    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setattr(
        "hermes_cli.profiles.resolve_profile_env",
        lambda profile: f"/tmp/hermes-profile-{profile}",
    )

    def _fake_cmd_aisoc(args: argparse.Namespace) -> None:
        called["module"] = args.module
        called["hermes_home"] = os.environ.get("HERMES_HOME")

    monkeypatch.setattr(backend_main, "cmd_aisoc", _fake_cmd_aisoc)

    exit_code = backend_main.main(["-p", "coder", "--module", "extcli"])

    assert exit_code == 0
    assert called == {
        "module": "extcli",
        "hermes_home": "/tmp/hermes-profile-coder",
    }


def test_main_supports_equals_profile_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    backend_main = _load_backend_main()
    called: dict[str, object] = {}

    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setattr(
        "hermes_cli.profiles.resolve_profile_env",
        lambda profile: f"/tmp/hermes-profile-{profile}",
    )

    def _fake_cmd_aisoc(args: argparse.Namespace) -> None:
        called["port"] = args.port
        called["hermes_home"] = os.environ.get("HERMES_HOME")

    monkeypatch.setattr(backend_main, "cmd_aisoc", _fake_cmd_aisoc)

    exit_code = backend_main.main(["--profile=writer", "--port", "9133"])

    assert exit_code == 0
    assert called == {
        "port": 9133,
        "hermes_home": "/tmp/hermes-profile-writer",
    }
