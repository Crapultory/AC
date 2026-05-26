from __future__ import annotations

import sys

import pytest

import hermes_cli.main as main_mod


def test_aisoc_registered_in_builtin_subcommands() -> None:
    assert "aisoc" in main_mod._BUILTIN_SUBCOMMANDS


def test_main_routes_aisoc_with_expected_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def _fake_cmd_aisoc(args) -> None:
        captured["args"] = args
        raise SystemExit(0)

    monkeypatch.setattr(main_mod, "cmd_aisoc", _fake_cmd_aisoc)
    monkeypatch.setattr(sys, "argv", ["hermes", "aisoc"])

    with pytest.raises(SystemExit) as exc:
        main_mod.main()

    assert exc.value.code == 0
    args = captured["args"]
    assert args is not None
    assert args.port == 9120
    assert args.host == "127.0.0.1"
    assert args.tui is False
    assert args.no_open is False
    assert args.insecure is False
    assert args.skip_build is False
    assert args.stop is False
    assert args.status is False

