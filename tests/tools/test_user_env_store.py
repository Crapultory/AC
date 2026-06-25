import json

import pytest


def _write_users_env(tmp_path, payload):
    path = tmp_path / "users.env.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def test_make_user_env_key_encodes_platform_and_components(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from tools.user_env_store import make_user_env_key

    key = make_user_env_key("we.com", "user/42", "Alice.Bob\n")
    assert key == "we.com.user%2F42"


def test_make_user_env_key_allows_empty_platform_and_user_name(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from tools.user_env_store import make_user_env_key

    key = make_user_env_key("", "user 42", "")
    assert key == ".user%2042"


def test_load_user_env_isolated_by_platform(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_users_env(
        tmp_path,
        {
            "slack.u123": {"CURRENT_USER_NAME": "alice", "API_TOKEN": "slack-token"},
            "telegram.u123": {"CURRENT_USER_NAME": "alice", "API_TOKEN": "telegram-token"},
        },
    )

    from tools.user_env_store import load_user_env

    slack = load_user_env("slack", "u123", "alice")
    telegram = load_user_env("telegram", "u123", "alice")

    assert slack.user_key == "slack.u123"
    assert slack.env == {"CURRENT_USER_NAME": "alice", "API_TOKEN": "slack-token"}
    assert telegram.user_key == "telegram.u123"
    assert telegram.env == {"CURRENT_USER_NAME": "alice", "API_TOKEN": "telegram-token"}


def test_load_user_env_migrates_legacy_key_to_platform_user_id_and_persists_current_user_name(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    path = _write_users_env(
        tmp_path,
        {
            "slack.u123.old-name": {"API_TOKEN": "old-token"},
            "telegram.u123.old-name": {"API_TOKEN": "telegram-token"},
        },
    )

    from tools.user_env_store import load_user_env

    loaded = load_user_env("slack", "u123", "new-name")

    assert loaded.user_key == "slack.u123"
    assert loaded.env == {"CURRENT_USER_NAME": "new-name", "API_TOKEN": "old-token"}

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert "slack.u123.old-name" not in payload
    assert payload["slack.u123"] == {
        "CURRENT_USER_NAME": "new-name",
        "API_TOKEN": "old-token",
    }
    assert payload["telegram.u123.old-name"] == {"API_TOKEN": "telegram-token"}


def test_load_user_env_warns_and_skips_ambiguous_username_migration(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_users_env(
        tmp_path,
        {
            "slack.u123.old-one": {"API_TOKEN": "one"},
            "slack.u123.old-two": {"API_TOKEN": "two"},
        },
    )

    from tools.user_env_store import load_user_env

    with caplog.at_level("WARNING"):
        loaded = load_user_env("slack", "u123", "new-name")

    assert loaded.user_key == "slack.u123"
    assert loaded.env == {"CURRENT_USER_NAME": "new-name"}
    assert any("Ambiguous user env migration" in message for message in caplog.messages)


def test_set_user_env_allows_non_shellsafe_names_except_os_impossible_ones(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from tools.user_env_store import list_user_env, set_user_env_var

    loaded = set_user_env_var("slack", "u123", "", "HAS SPACE", "value")
    assert loaded.env["HAS SPACE"] == "value"
    assert loaded.env["CURRENT_USER_NAME"] == ""
    assert list_user_env("slack", "u123", "").env["HAS SPACE"] == "value"

    with pytest.raises(ValueError, match="cannot contain '=' or NUL"):
        set_user_env_var("slack", "u123", "", "A=B", "value")
