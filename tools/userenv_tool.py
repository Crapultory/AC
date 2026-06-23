"""Tool for users to manage their own persisted env variables."""

from __future__ import annotations

from tools.registry import registry, tool_error, tool_result
from tools.user_env_runtime import get_current_user_env_identity
from tools.user_env_store import (
    CURRENT_USER_NAME_KEY,
    delete_user_env_var,
    list_user_env,
    set_user_env_var,
)


def _mask_value(_: str) -> str:
    return "******"


def _visible_env_items(env: dict[str, str]) -> list[tuple[str, str]]:
    return [
        (env_key, env_value)
        for env_key, env_value in sorted(env.items())
        if env_key != CURRENT_USER_NAME_KEY
    ]


def _require_identity():
    identity = get_current_user_env_identity()
    if identity is None:
        return None, tool_error("userenv is only available for an authenticated runtime user")
    return identity, None


def userenv_tool(action: str, key: str = "", value=None, **_kwargs) -> str:
    """Manage env vars for the current platform/user only."""
    identity, error = _require_identity()
    if error is not None:
        return error

    action_text = str(action or "").strip().lower()
    if action_text == "list":
        loaded = list_user_env(identity.platform, identity.user_id, identity.user_name)
        variables = [
            {"key": env_key, "masked_value": _mask_value(env_value)}
            for env_key, env_value in _visible_env_items(loaded.env)
        ]
        return tool_result(
            action="list",
            user_key=loaded.user_key,
            count=len(variables),
            variables=variables,
        )

    if action_text == "set":
        try:
            loaded = set_user_env_var(identity.platform, identity.user_id, identity.user_name, key, value)
        except ValueError as exc:
            return tool_error(str(exc))
        return tool_result(
            action="set",
            updated=True,
            user_key=loaded.user_key,
            key=str(key).strip(),
            masked_value=_mask_value(str(value)),
            count=len(_visible_env_items(loaded.env)),
        )

    if action_text == "delete":
        try:
            loaded, deleted = delete_user_env_var(identity.platform, identity.user_id, identity.user_name, key)
        except ValueError as exc:
            return tool_error(str(exc))
        return tool_result(
            action="delete",
            deleted=deleted,
            user_key=loaded.user_key,
            key=str(key).strip(),
            remaining=len(_visible_env_items(loaded.env)),
        )

    return tool_error("Unknown action. Use: set, list, delete")


USERENV_SCHEMA = {
    "name": "userenv",
    "description": (
        "Manage the calling user's own runtime environment variables. "
        "Scope is always limited to the current platform + user identity, "
        "so you can only read or modify your own env values. Use actions "
        "'set', 'list', or 'delete'. Values are masked in tool results."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["set", "list", "delete"],
                "description": "Operation to perform on the current user's env vars.",
            },
            "key": {
                "type": "string",
                "description": "Environment variable name. Required for 'set' and 'delete'.",
            },
            "value": {
                "type": "string",
                "description": "Environment variable value. Required for 'set'.",
            },
        },
        "required": ["action"],
    },
}


registry.register(
    name="userenv",
    toolset="userenv",
    schema=USERENV_SCHEMA,
    handler=lambda args, **kw: userenv_tool(
        action=args.get("action", ""),
        key=args.get("key", ""),
        value=args.get("value"),
    ),
    emoji="🪪",
)
