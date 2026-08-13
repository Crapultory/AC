from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


AUTH_TOKEN = "test-token"


def _clear_aisoc_backend_modules() -> None:
    for module_name in list(sys.modules):
        if module_name == "aisoc.backend" or module_name.startswith("aisoc.backend."):
            sys.modules.pop(module_name, None)


@pytest.fixture
def load_backend(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AISOC_SESSION_TOKEN", AUTH_TOKEN)

    def _load(module_name: str):
        _clear_aisoc_backend_modules()
        return importlib.import_module(module_name)

    return _load


@pytest.fixture
def hermes_home(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> Path:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("AISOC_SESSION_TOKEN", AUTH_TOKEN)
    return tmp_path


@pytest.fixture
def client(
    load_backend,
    hermes_home,
) -> Iterator[TestClient]:
    server = load_backend("aisoc.backend.server")
    app = server.create_app()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {AUTH_TOKEN}"}
