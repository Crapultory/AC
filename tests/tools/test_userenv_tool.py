import json
import os


def _read_users_env(tmp_path):
    path = tmp_path / "users.env.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def test_userenv_set_and_list_are_scoped_to_current_platform_user_and_mask_values(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from tools.environments.local import _make_run_env
    from tools.user_env_runtime import reset_current_user_env_identity, set_current_user_env_identity
    from tools.userenv_tool import userenv_tool

    token = set_current_user_env_identity("slack", "u123", "alice", "slack.u123.alice")
    try:
        set_result = json.loads(userenv_tool(action="set", key="GITHUB_TOKEN", value="ghp_secret_123"))
        list_result = json.loads(userenv_tool(action="list"))
        env = _make_run_env({"PATH": "/usr/bin:/bin"})
    finally:
        reset_current_user_env_identity(token)

    assert set_result["updated"] is True
    assert set_result["key"] == "GITHUB_TOKEN"
    assert "ghp_secret_123" not in json.dumps(set_result, ensure_ascii=False)

    assert list_result["user_key"] == "slack.u123.alice"
    assert list_result["count"] == 1
    assert list_result["variables"][0]["key"] == "GITHUB_TOKEN"
    assert "value" not in list_result["variables"][0]
    assert "ghp_secret_123" not in json.dumps(list_result, ensure_ascii=False)

    assert env["GITHUB_TOKEN"] == "ghp_secret_123"
    assert os.environ.get("GITHUB_TOKEN") != "ghp_secret_123"

    payload = _read_users_env(tmp_path)
    assert payload["slack.u123.alice"]["GITHUB_TOKEN"] == "ghp_secret_123"


def test_userenv_persists_across_identity_rebinds(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from tools.environments.local import _make_run_env
    from tools.user_env_runtime import reset_current_user_env_identity, set_current_user_env_identity
    from tools.userenv_tool import userenv_tool

    first_token = set_current_user_env_identity("slack", "u123", "alice", "slack.u123.alice")
    try:
        json.loads(userenv_tool(action="set", key="API_TOKEN", value="persisted-secret"))
    finally:
        reset_current_user_env_identity(first_token)

    second_token = set_current_user_env_identity("slack", "u123", "alice", "slack.u123.alice")
    try:
        list_result = json.loads(userenv_tool(action="list"))
        env = _make_run_env({"PATH": "/usr/bin:/bin"})
    finally:
        reset_current_user_env_identity(second_token)

    assert list_result["count"] == 1
    assert list_result["variables"][0]["key"] == "API_TOKEN"
    assert env["API_TOKEN"] == "persisted-secret"


def test_userenv_delete_removes_last_key_for_current_platform_user(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from tools.user_env_runtime import reset_current_user_env_identity, set_current_user_env_identity
    from tools.userenv_tool import userenv_tool

    token = set_current_user_env_identity("telegram", "u123", "alice", "telegram.u123.alice")
    try:
        json.loads(userenv_tool(action="set", key="API_TOKEN", value="secret"))
        delete_result = json.loads(userenv_tool(action="delete", key="API_TOKEN"))
    finally:
        reset_current_user_env_identity(token)

    assert delete_result["deleted"] is True
    assert delete_result["remaining"] == 0
    assert _read_users_env(tmp_path) == {}


def test_userenv_requires_current_user_identity(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from tools.userenv_tool import userenv_tool

    result = json.loads(userenv_tool(action="list"))
    assert "error" in result


def test_userenv_supports_empty_platform_and_user_name(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    from tools.user_env_runtime import reset_current_user_env_identity, set_current_user_env_identity
    from tools.userenv_tool import userenv_tool

    token = set_current_user_env_identity("", "u123", "", ".u123.")
    try:
        set_result = json.loads(userenv_tool(action="set", key="HAS SPACE", value="secret"))
        list_result = json.loads(userenv_tool(action="list"))
    finally:
        reset_current_user_env_identity(token)

    assert set_result["updated"] is True
    assert set_result["user_key"] == ".u123."
    assert list_result["user_key"] == ".u123."
    assert list_result["variables"][0]["key"] == "HAS SPACE"
