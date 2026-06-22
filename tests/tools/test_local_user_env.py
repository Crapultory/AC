import json


def _write_users_env(tmp_path, payload):
    path = tmp_path / "users.env.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def test_make_run_env_injects_current_platform_user_env(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_users_env(tmp_path, {"slack.u123.alice": {"CUSTOM_TOKEN": "abc123"}})

    from tools.environments.local import _make_run_env
    from tools.user_env_runtime import reset_current_user_env_identity, set_current_user_env_identity

    token = set_current_user_env_identity("slack", "u123", "alice", "slack.u123.alice")
    try:
        env = _make_run_env({"PATH": "/usr/bin:/bin"})
    finally:
        reset_current_user_env_identity(token)

    assert env["CUSTOM_TOKEN"] == "abc123"


def test_make_run_env_does_not_leak_previous_user_env_between_identities(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_users_env(
        tmp_path,
        {
            "slack.u123.alice": {"CUSTOM_TOKEN": "alice-token"},
            "slack.u456.bob": {"CUSTOM_TOKEN": "bob-token"},
        },
    )

    from tools.environments.local import _make_run_env
    from tools.user_env_runtime import reset_current_user_env_identity, set_current_user_env_identity

    alice_token = set_current_user_env_identity("slack", "u123", "alice", "slack.u123.alice")
    try:
        alice_env = _make_run_env({"PATH": "/usr/bin:/bin"})
    finally:
        reset_current_user_env_identity(alice_token)

    bob_token = set_current_user_env_identity("slack", "u456", "bob", "slack.u456.bob")
    try:
        bob_env = _make_run_env({"PATH": "/usr/bin:/bin"})
    finally:
        reset_current_user_env_identity(bob_token)

    assert alice_env["CUSTOM_TOKEN"] == "alice-token"
    assert bob_env["CUSTOM_TOKEN"] == "bob-token"


def test_make_run_env_supports_empty_platform_and_user_name(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _write_users_env(tmp_path, {".u123.": {"CUSTOM_TOKEN": "blank-identity-token"}})

    from tools.environments.local import _make_run_env
    from tools.user_env_runtime import reset_current_user_env_identity, set_current_user_env_identity

    token = set_current_user_env_identity("", "u123", "", ".u123.")
    try:
        env = _make_run_env({"PATH": "/usr/bin:/bin"})
    finally:
        reset_current_user_env_identity(token)

    assert env["CUSTOM_TOKEN"] == "blank-identity-token"
