from __future__ import annotations

import json

import pytest


def test_get_aegis_store_creates_default_file_and_returns_shared_instance(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    store_module = load_backend("aegis.backend.services.store")

    first = store_module.get_aegis_store()
    second = store_module.get_aegis_store()

    assert first is second
    assert first.read_locked() == {"a2a": {}, "global": []}
    assert json.loads((tmp_path / "a2a.json").read_text()) == {
        "a2a": {},
        "global": [],
    }


@pytest.mark.parametrize(
    ("initial_payload", "expected_payload"),
    [
        ({"a2a": {}}, {"a2a": {}, "global": []}),
        ({"global": []}, {"a2a": {}, "global": []}),
    ],
)
def test_get_aegis_store_normalizes_missing_top_level_keys(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    initial_payload: dict[str, object],
    expected_payload: dict[str, object],
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "a2a.json").write_text(json.dumps(initial_payload))

    store_module = load_backend("aegis.backend.services.store")
    store = store_module.get_aegis_store()

    assert store.read_locked() == expected_payload
    assert json.loads((tmp_path / "a2a.json").read_text()) == expected_payload


def test_get_aegis_store_raises_for_malformed_json(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "a2a.json").write_text("{not-json")

    with pytest.raises(json.JSONDecodeError):
        load_backend("aegis.backend.services.store").get_aegis_store()


@pytest.mark.parametrize(
    "invalid_payload",
    [
        {"a2a": [], "global": []},
        {"a2a": {}, "global": {}},
        [],
    ],
)
def test_get_aegis_store_rejects_invalid_top_level_shapes(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    invalid_payload: object,
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "a2a.json").write_text(json.dumps(invalid_payload))

    with pytest.raises(ValueError):
        load_backend("aegis.backend.services.store").get_aegis_store()


def test_mutate_locked_updates_shared_object_and_persists_to_disk(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    store_module = load_backend("aegis.backend.services.store")
    store = store_module.get_aegis_store()

    seen: dict[str, object] = {}

    def _mutate(payload: dict[str, object]) -> None:
        seen["payload"] = payload
        payload["global"].append({"id": "policy-1"})
        payload["a2a"]["agent-1"] = {"enabled": True}

    store.mutate_locked(_mutate)

    expected = {
        "a2a": {"agent-1": {"enabled": True}},
        "global": [{"id": "policy-1"}],
    }
    assert seen["payload"] is not store.read_locked()
    assert store.read_locked() == expected
    assert json.loads((tmp_path / "a2a.json").read_text()) == expected


def test_read_locked_returns_copy_that_cannot_mutate_store_state(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    store_module = load_backend("aegis.backend.services.store")
    store = store_module.get_aegis_store()
    snapshot = store.read_locked()

    snapshot["global"].append({"id": "policy-1"})
    snapshot["a2a"]["agent-1"] = {"enabled": True}

    assert store.read_locked() == {"a2a": {}, "global": []}
    assert json.loads((tmp_path / "a2a.json").read_text()) == {
        "a2a": {},
        "global": [],
    }


def test_mutate_locked_does_not_persist_failed_mutations(
    load_backend,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    store_module = load_backend("aegis.backend.services.store")
    store = store_module.get_aegis_store()

    with pytest.raises(RuntimeError, match="boom"):
        store.mutate_locked(
            lambda payload: (
                payload["global"].append({"id": "policy-1"}),
                (_ for _ in ()).throw(RuntimeError("boom")),
            )
        )

    assert store.read_locked() == {"a2a": {}, "global": []}
    assert json.loads((tmp_path / "a2a.json").read_text()) == {
        "a2a": {},
        "global": [],
    }
