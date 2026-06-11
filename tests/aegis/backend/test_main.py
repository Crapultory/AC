from __future__ import annotations

import argparse
import importlib
import importlib.util

import pytest


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
