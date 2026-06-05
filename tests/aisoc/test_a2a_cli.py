from __future__ import annotations

import argparse

import pytest

import hermes_cli.main as main_mod


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


def test_cmd_aisoc_dispatches_a2a_module(monkeypatch: pytest.MonkeyPatch) -> None:
    called: dict[str, object] = {}

    def _fake_start_a2a_server(**kwargs) -> None:
        called.update(kwargs)

    monkeypatch.setattr(
        "aisoc.backend.a2a_server.start_a2a_server",
        _fake_start_a2a_server,
        raising=False,
    )
    main_mod.cmd_aisoc(
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
    with pytest.raises(SystemExit) as exc:
        main_mod.cmd_aisoc(_ns(module="a2a", tui=True))
    assert exc.value.code == 2


def test_cmd_aisoc_dispatches_extcli_module(monkeypatch: pytest.MonkeyPatch) -> None:
    called: dict[str, object] = {}

    def _fake_start_extcli(**kwargs) -> None:
        called.update(kwargs)

    monkeypatch.setattr(
        "aisoc.backend.extcli.start_extcli",
        _fake_start_extcli,
        raising=False,
    )
    main_mod.cmd_aisoc(_ns(module="extcli"))

    assert called == {}


def test_cmd_aisoc_rejects_a2a_only_flags_for_extcli() -> None:
    with pytest.raises(SystemExit) as exc:
        main_mod.cmd_aisoc(_ns(module="extcli", streaming=True))
    assert exc.value.code == 2
