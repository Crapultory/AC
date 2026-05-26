"""Skills service adapters."""

from __future__ import annotations

from typing import Any

from hermes_cli.config import load_config


def list_skills() -> list[dict[str, Any]]:
    from tools.skills_tool import _find_all_skills
    from hermes_cli.skills_config import get_disabled_skills

    config = load_config()
    disabled = get_disabled_skills(config)
    skills = _find_all_skills(skip_disabled=True)
    for skill in skills:
        skill["enabled"] = skill["name"] not in disabled
    return skills


def toggle_skill(name: str, enabled: bool) -> dict[str, Any]:
    from hermes_cli.skills_config import get_disabled_skills, save_disabled_skills

    config = load_config()
    disabled = get_disabled_skills(config)
    if enabled:
        disabled.discard(name)
    else:
        disabled.add(name)
    save_disabled_skills(config, disabled)
    return {"ok": True, "name": name, "enabled": enabled}


def reload_index() -> bool:
    # Current skill discovery is file-based and reads fresh on each call.
    # Returning True provides a stable API for future cached index support.
    return True

