"""Extended delegation tool for single-agent task execution."""

from __future__ import annotations

import asyncio
import json
import logging
from types import SimpleNamespace
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape

import httpx
from google.protobuf.json_format import MessageToDict
from aisoc.backend.agent_runtime import load_conversation_history
from hermes_cli.profiles import get_active_profile_name
from hermes_constants import get_hermes_home
from toolsets import validate_toolset
from tools.delegate_tool import (
    _build_child_system_prompt,
    _resolve_child_credential_pool,
    _resolve_workspace_hint,
    check_delegate_requirements,
)
from tools.registry import registry, tool_error


logger = logging.getLogger(__name__)

DEFAULT_AGENT_MODE = "a2a"
DEFAULT_TOOLSETS = ["hermes-cli"]
DEFAULT_MAX_ITERATIONS = 90
_DELEGATE_FOREGROUND_INPUT_TIMEOUT_SECONDS = 25 * 60
A2A_REGISTRY: Dict[str, Dict[str, Any]] = {}
A2A_CONTEXT = ""
_ACTIVE_A2A_SESSION_ATTR = "_active_a2a_delegate_session"
_ACTIVE_A2A_SESSION_LOCK_ATTR = "_active_a2a_delegate_session_lock"
_A2A_STOP_MESSAGE = "已按用户请求停止当前 A2A 委托，无需重试。"
_A2A_INPUT_TIMEOUT_MESSAGE = "waitting user input timeout,close remote session, do not retry"
_A2A_CANCEL_STATUS_NOOP = "noop"
_A2A_CANCEL_STATUS_SENT = "sent"
_A2A_CANCEL_STATUS_COMPLETED = "completed"
_DELEGATE_INPUT_TIMEOUT = object()


A2A_LIST_SCHEMA = {
    "name": "a2a_list",
    "description": "Build Aegis XML context from active A2A agents and global routing rules.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}


def _a2a_registry_path() -> Path:
    return Path(get_hermes_home()) / "a2a.json"


def _fetch_agent_card(
    base_url: str,
    *,
    headers: dict[str, str] | None = None,
) -> tuple[dict[str, Any] | None, str | None]:
    card_url = base_url.rstrip("/") + "/.well-known/agent-card.json"
    try:
        response = httpx.get(card_url, timeout=5.0, headers=headers or None)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        return None, str(exc)
    if not isinstance(payload, dict):
        return None, "agent card must be a JSON object."
    return payload, None


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str) and item]


def _normalize_a2a_headers(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, str] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key.strip() or item is None:
            continue
        normalized[key] = str(item)
    return normalized


def _merge_capabilities(*capability_lists: list[str]) -> list[str]:
    merged: list[str] = []
    for items in capability_lists:
        for item in items:
            if item not in merged:
                merged.append(item)
    return merged


def _normalize_a2a_registry_entry(name: Any, raw_entry: Any) -> dict[str, Any]:
    entry_name = str(name)
    normalized: dict[str, Any] = {
        "name": entry_name,
        "description": None,
        "status": None,
        "headers": {},
        "extcapabilities": [],
    }
    if isinstance(raw_entry, str):
        normalized["url"] = _normalize_a2a_base_url(raw_entry)
        return normalized
    if not isinstance(raw_entry, dict):
        raise ValueError(f"A2A agent {entry_name!r} must be a URL string or object.")

    normalized["url"] = _normalize_a2a_base_url(raw_entry.get("url", ""))
    description = raw_entry.get("description")
    if isinstance(description, str) and description:
        normalized["description"] = description
    status = raw_entry.get("status")
    if status is not None:
        status_text = str(status).strip().lower()
        if status_text:
            normalized["status"] = status_text
    normalized["headers"] = _normalize_a2a_headers(raw_entry.get("headers"))
    normalized["extcapabilities"] = _normalize_string_list(raw_entry.get("extcapabilities"))
    return normalized


def _public_a2a_entry(entry: dict[str, Any]) -> dict[str, Any]:
    public_entry = dict(entry)
    public_entry.pop("headers", None)
    return public_entry


def _xml_text(value: Any) -> str:
    return escape(str(value if value is not None else ""), {"'": "&apos;", '"': "&quot;"})


def _extract_a2a_skill_strings(card_json: dict[str, Any] | None) -> list[str]:
    if not isinstance(card_json, dict):
        return []
    extracted: list[str] = []
    for skill in card_json.get("skills", []):
        if not isinstance(skill, dict):
            continue
        parts: list[str] = []
        skill_id = skill.get("id")
        if isinstance(skill_id, str) and skill_id.strip():
            parts.append(f"id={skill_id.strip()}")
        name = skill.get("name")
        if isinstance(name, str) and name.strip():
            parts.append(f"name={name.strip()}")
        description = skill.get("description")
        if isinstance(description, str) and description.strip():
            parts.append(f"description={description.strip()}")
        tags = skill.get("tags")
        if isinstance(tags, list):
            cleaned_tags = [str(tag).strip() for tag in tags if str(tag).strip()]
            if cleaned_tags:
                parts.append(f"tags={','.join(cleaned_tags)}")
        examples = skill.get("examples")
        if isinstance(examples, list):
            cleaned_examples = [str(example).strip() for example in examples if str(example).strip()]
            if cleaned_examples:
                parts.append(f"examples={'; '.join(cleaned_examples)}")
        input_modes = skill.get("inputModes")
        if isinstance(input_modes, list):
            cleaned_input_modes = [str(mode).strip() for mode in input_modes if str(mode).strip()]
            if cleaned_input_modes:
                parts.append(f"inputModes={','.join(cleaned_input_modes)}")
        output_modes = skill.get("outputModes")
        if isinstance(output_modes, list):
            cleaned_output_modes = [str(mode).strip() for mode in output_modes if str(mode).strip()]
            if cleaned_output_modes:
                parts.append(f"outputModes={','.join(cleaned_output_modes)}")
        if parts:
            extracted.append(" | ".join(parts))
    return list(dict.fromkeys(extracted))


def _extract_a2a_capabilities(card_json: dict[str, Any] | None) -> list[str]:
    if not isinstance(card_json, dict):
        return []
    extracted = list(_extract_a2a_skill_strings(card_json))

    # Preserve order while removing duplicates from overlapping fields.
    return list(dict.fromkeys(extracted))


def _summarize_agent_card(card_json: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(card_json, dict):
        return None

    capabilities = card_json.get("capabilities")
    skill_names: list[str] = []
    for skill in card_json.get("skills", []):
        if isinstance(skill, dict):
            skill_name = skill.get("name") or skill.get("id")
            if isinstance(skill_name, str) and skill_name:
                skill_names.append(skill_name)

    interface_summaries: list[dict[str, str]] = []
    for interface in card_json.get("supported_interfaces", []):
        if not isinstance(interface, dict):
            continue
        item: dict[str, str] = {}
        url = interface.get("url")
        if isinstance(url, str) and url:
            item["url"] = url
        binding = interface.get("protocol_binding")
        if isinstance(binding, str) and binding:
            item["protocol_binding"] = binding
        version = interface.get("protocol_version")
        if isinstance(version, str) and version:
            item["protocol_version"] = version
        if item:
            interface_summaries.append(item)

    summary: dict[str, Any] = {
        "name": card_json.get("name") if isinstance(card_json.get("name"), str) else None,
        "description": (
            card_json.get("description") if isinstance(card_json.get("description"), str) else None
        ),
        "version": card_json.get("version") if isinstance(card_json.get("version"), str) else None,
        "default_input_modes": _normalize_string_list(card_json.get("default_input_modes")),
        "default_output_modes": _normalize_string_list(card_json.get("default_output_modes")),
        "capabilities": {
            key: value
            for key, value in capabilities.items()
            if isinstance(capabilities, dict) and isinstance(key, str) and isinstance(value, bool)
        }
        if isinstance(capabilities, dict)
        else {},
        "skills": skill_names,
        "supported_interfaces": interface_summaries,
    }
    return summary


def _load_a2a_registry(force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    if A2A_REGISTRY and not force_refresh:
        return dict(A2A_REGISTRY)

    path = _a2a_registry_path()
    if not path.exists():
        A2A_REGISTRY.clear()
        return {}

    raw = json.loads(path.read_text(encoding="utf-8"))
    entries = raw.get("a2a")
    if not isinstance(entries, dict):
        raise ValueError("a2a.json must contain an object-valued 'a2a' mapping.")

    loaded: dict[str, dict[str, Any]] = {}
    for name, raw_entry in entries.items():
        try:
            entry = _normalize_a2a_registry_entry(name, raw_entry)
        except ValueError as exc:
            loaded[str(name)] = {
                "name": str(name),
                "url": str(raw_entry.get("url", "")) if isinstance(raw_entry, dict) else str(raw_entry),
                "available": False,
                "capabilities": [],
                "agent_card": None,
                "agent_card_name": None,
                "error": str(exc),
            }
            continue

        if entry.get("status") != "active":
            continue

        fetch_kwargs: dict[str, Any] = {}
        if entry.get("headers"):
            fetch_kwargs["headers"] = dict(entry["headers"])
        card_json, error = _fetch_agent_card(entry["url"], **fetch_kwargs)
        loaded[str(name)] = {
            "name": str(name),
            "url": entry["url"],
            "description": entry.get("description"),
            "status": entry.get("status"),
            "available": error is None,
            "capabilities": _merge_capabilities(
                _extract_a2a_capabilities(card_json),
                entry.get("extcapabilities", []),
            ),
            "agent_card": _summarize_agent_card(card_json) if error is None else None,
            "agent_card_name": card_json.get("name") if isinstance(card_json, dict) else None,
            "headers": entry.get("headers", {}),
            "error": error,
        }

    A2A_REGISTRY.clear()
    A2A_REGISTRY.update(loaded)
    return dict(A2A_REGISTRY)


def _load_aegis_context_payload() -> dict[str, Any]:
    path = _a2a_registry_path()
    if not path.exists():
        return {"a2a": {}, "global": []}

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("a2a.json must contain a top-level JSON object.")
    entries = raw.get("a2a", {})
    if not isinstance(entries, dict):
        raise ValueError("a2a.json must contain an object-valued 'a2a' mapping.")
    global_rules = raw.get("global", [])
    if not isinstance(global_rules, list):
        raise ValueError("a2a.json must contain an array-valued 'global' list.")
    return {"a2a": entries, "global": global_rules}


def _build_aegis_context_xml() -> str:
    payload = _load_aegis_context_payload()
    lines = [
        "<aegis_context>",
        "  <active_agents>",
    ]

    for name, raw_entry in payload["a2a"].items():
        entry = _normalize_a2a_registry_entry(name, raw_entry)
        if entry.get("status") != "active":
            continue
        fetch_kwargs: dict[str, Any] = {}
        if entry.get("headers"):
            fetch_kwargs["headers"] = dict(entry["headers"])
        card_json, _error = _fetch_agent_card(entry["url"], **fetch_kwargs)
        merged_capabilities = _merge_capabilities(
            _extract_a2a_capabilities(card_json),
            entry.get("extcapabilities", []),
        )
        description = entry.get("description")
        if not description and isinstance(card_json, dict):
            card_description = card_json.get("description")
            if isinstance(card_description, str) and card_description.strip():
                description = card_description.strip()

        lines.append(
            f'    <agent id="{_xml_text(name)}" url="{_xml_text(entry["url"])}" status="active">'
        )
        lines.append(f"      <description>{_xml_text(description or '')}</description>")
        lines.append("      <capabilities>")
        for capability in merged_capabilities:
            lines.append(f"        <capability>{_xml_text(capability)}</capability>")
        lines.append("      </capabilities>")
        lines.append("    </agent>")

    lines.extend(
        [
            "  </active_agents>",
            "  <global_routing>",
        ]
    )

    for rule in payload["global"]:
        if not isinstance(rule, dict):
            continue
        if str(rule.get("status") or "").strip().lower() != "active":
            continue
        lines.append(
            f'    <rule id="{_xml_text(rule.get("id") or "")}" status="active">'
        )
        lines.append(f"      <name>{_xml_text(rule.get('name') or '')}</name>")
        lines.append(f"      <policy>{_xml_text(rule.get('policy') or '')}</policy>")
        lines.append("    </rule>")

    lines.extend(
        [
            "  </global_routing>",
            "</aegis_context>",
        ]
    )
    return "\n".join(lines)


def _child_session_id(child) -> str | None:
    session_id = getattr(child, "session_id", None)
    return str(session_id) if isinstance(session_id, str) and session_id else None


def _normalize_delegate_session_id(value: Any) -> str | None:
    if value is None:
        return None
    session_id = str(value).strip()
    return session_id or None


def _default_delegate_session_id(agent_mode: str) -> str:
    profile_name = str(get_active_profile_name() or "default").strip() or "default"
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    return f"delegate_{profile_name}_{agent_mode}_{timestamp}"


def _resolve_delegate_session_id(agent_mode: str, session_id: Any = None) -> str:
    return _normalize_delegate_session_id(session_id) or _default_delegate_session_id(agent_mode)


def _emit_delegate_event(
    output,
    source: str,
    event_type: str,
    content: str,
    *,
    session_id: str | None = None,
) -> None:
    if output is None:
        return
    emit = getattr(output, "emit", None)
    if not callable(emit):
        return
    try:
        emit(source, event_type, content, session_id=session_id)
    except TypeError:
        emit(source, event_type, content)


def _read_delegate_input(input_adapter, timeout: float | None = None):
    if input_adapter is None:
        return None
    read_line = getattr(input_adapter, "read_line", None)
    if callable(read_line):
        if timeout is None:
            return read_line()
        try:
            line = read_line(timeout=timeout)
        except TypeError as exc:
            if "timeout" not in str(exc):
                raise
            line = read_line()
        if line is None and _delegate_input_timed_out(input_adapter):
            return _DELEGATE_INPUT_TIMEOUT
        return line
    return None


def _delegate_input_timed_out(input_adapter) -> bool:
    timed_out = getattr(input_adapter, "last_read_timed_out", None)
    if callable(timed_out):
        try:
            return bool(timed_out())
        except Exception:
            return False
    return bool(getattr(input_adapter, "_last_read_timed_out", False))


def _touch_parent_activity_for_delegate_input(parent_agent) -> None:
    touch = getattr(parent_agent, "_touch_activity", None)
    if not callable(touch):
        return
    try:
        touch("a2a_delegate: received foreground input")
    except Exception:
        pass


def _strip_recursive_delegate_tool(child) -> None:
    valid_tool_names = getattr(child, "valid_tool_names", None)
    if valid_tool_names:
        valid_tool_names.discard("a2a_delegate")
    tool_definitions = getattr(child, "tool_definitions", None)
    if tool_definitions:
        child.tool_definitions = [
            tool
            for tool in tool_definitions
            if tool.get("function", {}).get("name") != "a2a_delegate"
        ]


def _enter_delegate_foreground(input_adapter) -> bool:
    enter = getattr(input_adapter, "enter_foreground", None)
    if callable(enter):
        return bool(enter())
    return True


def _exit_delegate_foreground(input_adapter) -> None:
    exit_foreground = getattr(input_adapter, "exit_foreground", None)
    if callable(exit_foreground):
        exit_foreground()


def _format_aegis_source_header(parent_agent) -> str:
    raw_user_id = getattr(parent_agent, "_user_id", "")
    raw_user_name = getattr(parent_agent, "_user_name", "")
    raw_platform = getattr(parent_agent, "platform", "")
    user_id = raw_user_id.strip() if isinstance(raw_user_id, str) else ""
    user_name = raw_user_name.strip() if isinstance(raw_user_name, str) else ""
    platform = raw_platform.strip() if isinstance(raw_platform, str) else ""
    if not user_id and not user_name:
        return ""
    source_data = {"platform": platform}
    if user_id:
        source_data["uid"] = user_id
    if user_name:
        source_data["uname"] = user_name
    source_payload = json.dumps(source_data, ensure_ascii=False, separators=(",", ":"))
    return f"<source>{source_payload}</source>"


def _decorate_a2a_user_message(text: str, parent_agent) -> str:
    source_header = _format_aegis_source_header(parent_agent)
    if not source_header:
        return text
    return f"{source_header}\n\n{text}"


def _normalize_toolsets(toolsets: Optional[List[str]]) -> tuple[Optional[List[str]], Optional[str]]:
    if toolsets is None:
        return list(DEFAULT_TOOLSETS), None
    if not isinstance(toolsets, list) or not all(isinstance(t, str) for t in toolsets):
        return None, "toolsets must be an array of toolset names."
    cleaned = [t.strip() for t in toolsets if isinstance(t, str) and t.strip()]
    if not cleaned:
        return list(DEFAULT_TOOLSETS), None
    invalid = [name for name in cleaned if not validate_toolset(name)]
    if invalid:
        return None, f"Unknown toolset(s): {', '.join(invalid)}."
    return cleaned, None


def _normalize_max_iterations(value: Optional[int], parent_agent) -> tuple[int, Optional[str]]:
    if value is None:
        inherited = getattr(parent_agent, "max_iterations", None)
        if isinstance(inherited, int) and inherited > 0:
            return inherited, None
        return DEFAULT_MAX_ITERATIONS, None
    try:
        max_iterations = int(value)
    except Exception:
        return 0, "max_iterations must be a positive integer."
    if max_iterations <= 0:
        return 0, "max_iterations must be a positive integer."
    return max_iterations, None


def a2a_list() -> str:
    """Return Aegis XML context built from active A2A agents and routing rules."""
    global A2A_CONTEXT
    try:
        xml_payload = _build_aegis_context_xml()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return tool_error(str(exc), success=False)
    A2A_CONTEXT = xml_payload
    return json.dumps(xml_payload, ensure_ascii=False)


def _run_coro_sync(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def _runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except BaseException as exc:  # pragma: no cover - passthrough guard
            error["exc"] = exc

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    thread.join()
    if "exc" in error:
        raise error["exc"]
    return result.get("value")


def _is_benign_a2a_stop_exception(exc: BaseException) -> bool:
    message = str(exc or "").strip().lower()
    if not message:
        return False
    benign_markers = (
        "event loop is closed",
        "attached to a different loop",
        "bound to a different event loop",
        "different event loop",
        "non-thread-safe operation invoked on an event loop",
        "event loop stopped before future completed",
    )
    return any(marker in message for marker in benign_markers)


def _build_a2a_stop_final_response(last_text: str | None) -> str:
    cleaned = str(last_text or "").strip()
    if not cleaned:
        return _A2A_STOP_MESSAGE
    return f"{_A2A_STOP_MESSAGE}\n\n停止前最后输出：{cleaned}"


class _RemoteA2ADelegateCancelHandle:
    def __init__(self, session: "_A2ADelegateSession") -> None:
        self._session = session
        self._lock = threading.Lock()

    def has_live_task(self) -> bool:
        return bool(getattr(self._session, "task_id", None))

    def _log_async_cancel_outcome(self, future) -> None:
        try:
            future.result()
        except Exception as exc:
            if self._session.should_suppress_stop_exception(exc):
                logger.debug("Suppressing benign async A2A stop exception", exc_info=True)
                return
            logger.warning("Asynchronous A2A cancel failed after request dispatch: %s", exc, exc_info=True)

    def cancel(self) -> str:
        self._session.mark_stop_requested()
        if not self.has_live_task():
            return _A2A_CANCEL_STATUS_NOOP
        with self._lock:
            if not self.has_live_task():
                return _A2A_CANCEL_STATUS_NOOP
            try:
                owner_loop, owner_thread_id = self._session.owner_runtime()
                current_thread_id = threading.get_ident()
                if owner_loop is not None and owner_loop.is_running() and owner_thread_id != current_thread_id:
                    future = asyncio.run_coroutine_threadsafe(
                        self._session.cancel(use_existing_client=True),
                        owner_loop,
                    )
                    if future.done():
                        future.result()
                        return _A2A_CANCEL_STATUS_COMPLETED
                    future.add_done_callback(self._log_async_cancel_outcome)
                    return _A2A_CANCEL_STATUS_SENT
                else:
                    # If the owner loop is not available to schedule onto,
                    # cancel with a fresh client instead of reusing loop-bound state.
                    _run_coro_sync(self._session.cancel(use_existing_client=False))
                    return _A2A_CANCEL_STATUS_COMPLETED
            except Exception as exc:
                if self._session.should_suppress_stop_exception(exc):
                    logger.debug("Suppressing benign A2A stop exception", exc_info=True)
                    return _A2A_CANCEL_STATUS_SENT
                raise
        return _A2A_CANCEL_STATUS_COMPLETED


def _parent_active_a2a_session_lock(parent_agent) -> threading.Lock:
    lock = getattr(parent_agent, _ACTIVE_A2A_SESSION_LOCK_ATTR, None)
    if lock is None:
        lock = threading.Lock()
        setattr(parent_agent, _ACTIVE_A2A_SESSION_LOCK_ATTR, lock)
    return lock


def _register_active_a2a_session(parent_agent, session: "_A2ADelegateSession"):
    if parent_agent is None:
        return None
    handle = _RemoteA2ADelegateCancelHandle(session)
    lock = _parent_active_a2a_session_lock(parent_agent)
    with lock:
        setattr(parent_agent, _ACTIVE_A2A_SESSION_ATTR, handle)
    return handle


def _clear_active_a2a_session(parent_agent, handle) -> None:
    if parent_agent is None or handle is None:
        return
    lock = _parent_active_a2a_session_lock(parent_agent)
    with lock:
        if getattr(parent_agent, _ACTIVE_A2A_SESSION_ATTR, None) is handle:
            setattr(parent_agent, _ACTIVE_A2A_SESSION_ATTR, None)


def _normalize_a2a_base_url(url: str) -> str:
    value = str(url or "").strip()
    if not value:
        raise ValueError("A2A agent URL cannot be empty.")
    if "://" not in value:
        value = f"http://{value}"
    if value.endswith("/.well-known/agent-card.json"):
        value = value[: -len("/.well-known/agent-card.json")]
    return value.rstrip("/")


def _a2a_field(value, name: str, default=None):
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)


def _a2a_message_text(message) -> str:
    parts = list(_a2a_field(message, "parts", []) or [])
    chunks = [part.text for part in parts if getattr(part, "text", "")]
    if chunks:
        return "".join(chunks)

    content = _a2a_field(message, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                text_chunks.append(item)
                continue
            if isinstance(item, dict) and item.get("type") == "text":
                text_chunks.append(str(item.get("text", "")))
        return "".join(text_chunks)
    if content is None:
        return ""
    if isinstance(content, (dict, list)):
        return json.dumps(content, ensure_ascii=True, separators=(",", ":"))
    return str(content)


def _a2a_message_metadata(message) -> dict[str, Any]:
    metadata = _a2a_field(message, "metadata", None)
    if metadata is None:
        return {}
    if isinstance(metadata, dict):
        return metadata
    try:
        return MessageToDict(metadata)
    except Exception:
        return {}


def _a2a_hermes_metadata(message) -> dict[str, Any]:
    hermes = _a2a_message_metadata(message).get("hermes")
    return hermes if isinstance(hermes, dict) else {}


def _a2a_is_tool_message(message) -> bool:
    if message is None:
        return False
    from a2a.types import Role

    hermes = _a2a_hermes_metadata(message)
    if hermes.get("kind") == "tool_result":
        return True
    role = _a2a_field(message, "role", None)
    return role in ("tool", "ROLE_TOOL", getattr(Role, "ROLE_TOOL", object()))


def _a2a_message_tool_calls(message) -> list[dict[str, Any]]:
    tool_calls = list(_a2a_field(message, "tool_calls", []) or [])
    if tool_calls:
        return tool_calls
    hermes = _a2a_hermes_metadata(message)
    if hermes.get("kind") != "tool_call":
        return []
    return [
        {
            "id": hermes.get("tool_call_id", ""),
            "function": {
                "name": hermes.get("name", "tool"),
                "arguments": hermes.get("arguments", {}),
            },
        }
    ]


def _compact_json_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    text = str(value)
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except Exception:
        return text
    return json.dumps(parsed, ensure_ascii=True, separators=(",", ":"))


def _a2a_tool_call_details(tool_call) -> tuple[str, str, str]:
    call_id = str(_a2a_field(tool_call, "id", "") or "")
    function = _a2a_field(tool_call, "function", {}) or {}
    tool_name = str(_a2a_field(function, "name", "tool") or "tool")
    arguments = _compact_json_text(_a2a_field(function, "arguments", ""))
    return call_id, tool_name, arguments


def _a2a_tool_result_details(
    message,
    tool_names_by_call_id: dict[str, str],
) -> tuple[str, str]:
    hermes = _a2a_hermes_metadata(message)
    if hermes.get("kind") == "tool_result":
        tool_name = str(hermes.get("name") or "tool")
        return tool_name, _compact_json_text(hermes.get("result", ""))
    tool_call_id = str(_a2a_field(message, "tool_call_id", "") or "")
    tool_name = str(_a2a_field(message, "tool_name", "") or "")
    if not tool_name and tool_call_id:
        tool_name = tool_names_by_call_id.get(tool_call_id, "")
    if not tool_name:
        tool_name = "tool"
    return tool_name, _compact_json_text(_a2a_message_text(message))


def _a2a_is_agent_message(message) -> bool:
    if message is None:
        return False
    from a2a.types import Role

    hermes = _a2a_hermes_metadata(message)
    if hermes.get("kind") in {"tool_call", "tool_result"}:
        return False
    role = _a2a_field(message, "role", None)
    return role in (None, Role.ROLE_AGENT, "assistant", "agent", "ROLE_AGENT")


def _a2a_assistant_message_text(message) -> str:
    if not _a2a_is_agent_message(message):
        return ""
    return _a2a_message_text(message)


def _a2a_task_text(task) -> str:
    status = getattr(task, "status", None)
    text = _a2a_assistant_message_text(_a2a_field(status, "message", None))
    if text:
        return text

    for message in reversed(list(_a2a_field(task, "history", []) or [])):
        text = _a2a_assistant_message_text(message)
        if text:
            return text
    return ""


def _a2a_task_messages(task) -> list[Any]:
    messages = list(_a2a_field(task, "history", []) or [])
    status = _a2a_field(task, "status", None)
    status_message = _a2a_field(status, "message", None)
    if status_message is not None:
        messages.append(status_message)
    return messages


def _a2a_event_messages(event) -> list[Any]:
    if event.HasField("task"):
        return _a2a_task_messages(event.task)
    if event.HasField("message"):
        return [event.message]
    if event.HasField("status_update"):
        status = _a2a_field(event.status_update, "status", None)
        message = _a2a_field(status, "message", None)
        return [message] if message is not None else []
    return []


def _a2a_event_to_task(event):
    if event.HasField("task"):
        return event.task
    if event.HasField("message"):
        return SimpleNamespace(
            id=event.message.task_id,
            context_id=event.message.context_id,
            status=SimpleNamespace(state="completed", message=event.message),
            history=[event.message],
        )
    if event.HasField("status_update"):
        status = event.status_update.status
        return SimpleNamespace(
            id=event.status_update.task_id,
            context_id=event.status_update.context_id,
            status=SimpleNamespace(
                state=getattr(status, "state", None),
                message=getattr(status, "message", None),
            ),
            history=[],
        )
    return None


def _a2a_final_task_states() -> set[Any]:
    from a2a.types import TaskState

    return {
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_INPUT_REQUIRED,
        TaskState.TASK_STATE_REJECTED,
        TaskState.TASK_STATE_AUTH_REQUIRED,
        "completed",
    }


def _a2a_completed_state() -> Any:
    from a2a.types import TaskState

    return TaskState.TASK_STATE_COMPLETED


def _a2a_input_required_state() -> Any:
    from a2a.types import TaskState

    return TaskState.TASK_STATE_INPUT_REQUIRED


def _a2a_canceled_state() -> Any:
    from a2a.types import TaskState

    return TaskState.TASK_STATE_CANCELED


def _a2a_state_name(state: Any) -> str:
    from a2a.types import TaskState

    if isinstance(state, str):
        return state.lower()
    try:
        return TaskState.Name(state).replace("TASK_STATE_", "").lower()
    except Exception:
        return str(state)


class _A2ADelegateSession:
    def __init__(
        self,
        base_url: str,
        *,
        headers: dict[str, str] | None = None,
        output=None,
        timeout: float = 60.0,
        poll_interval: float = 1,
        session_id: str | None = None,
    ) -> None:
        self.base_url = _normalize_a2a_base_url(base_url)
        self.headers = dict(headers or {})
        self.output = output
        self.timeout = timeout
        self.poll_interval = poll_interval
        self.context_id: str | None = _normalize_delegate_session_id(session_id)
        self.task_id: str | None = None
        self._http_client = None
        self._client = None
        self._rendered_tool_entries: set[str] = set()
        self._tool_names_by_call_id: dict[str, str] = {}
        self._streamed_assistant_text = ""
        self._last_assistant_text = ""
        self._state_lock = threading.RLock()
        self._owner_loop: asyncio.AbstractEventLoop | None = None
        self._owner_thread_id: int | None = None
        self._stop_requested = False

    def _bind_owner_runtime(self) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        with self._state_lock:
            if self._owner_loop is None:
                self._owner_loop = loop
            if self._owner_thread_id is None:
                self._owner_thread_id = threading.get_ident()

    def owner_runtime(self) -> tuple[asyncio.AbstractEventLoop | None, int | None]:
        with self._state_lock:
            return self._owner_loop, self._owner_thread_id

    def mark_stop_requested(self) -> None:
        with self._state_lock:
            self._stop_requested = True

    def stop_requested(self) -> bool:
        with self._state_lock:
            return self._stop_requested

    def latest_assistant_text(self) -> str:
        with self._state_lock:
            return self._last_assistant_text

    def should_suppress_stop_exception(self, exc: BaseException) -> bool:
        return self.stop_requested() and _is_benign_a2a_stop_exception(exc)

    def _snapshot_remote_ids(self) -> tuple[str | None, str | None]:
        with self._state_lock:
            return self.task_id, self.context_id

    def _set_remote_ids(self, *, task_id: str | None, context_id: str | None) -> None:
        with self._state_lock:
            self.task_id = task_id or self.task_id
            self.context_id = context_id or self.context_id

    def _set_last_assistant_text(self, text: str) -> None:
        with self._state_lock:
            self._last_assistant_text = text

    def _build_http_client(self):
        return httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=10.0,
                read=None,
                write=60.0,
                pool=60.0,
            ),
            headers=self.headers or None,
        )

    async def _create_remote_client(self, http_client):
        from a2a.client import ClientConfig, ClientFactory

        factory = ClientFactory(
            ClientConfig(
                httpx_client=http_client,
                streaming=True,
                polling=True,
            )
        )
        return await factory.create_from_url(self.base_url)

    async def open(self) -> None:
        self._bind_owner_runtime()
        if self._client is not None:
            return
        self._http_client = self._build_http_client()
        self._client = await self._create_remote_client(self._http_client)

    async def close(self) -> None:
        self._bind_owner_runtime()
        owner_loop, _owner_thread_id = self.owner_runtime()
        if owner_loop is not None:
            current_loop = asyncio.get_running_loop()
            if current_loop is not owner_loop:
                raise RuntimeError("A2A delegate session close must run on the owner event loop.")
        client = self._client
        http_client = self._http_client
        self._client = None
        self._http_client = None
        if client is not None:
            await client.close()
        if http_client is not None:
            await http_client.aclose()

    async def cancel(self, *, use_existing_client: bool = True):
        from a2a.types import CancelTaskRequest

        self.mark_stop_requested()
        if use_existing_client:
            self._bind_owner_runtime()
            await self.open()
            client = self._client
            http_client = None
        else:
            http_client = self._build_http_client()
            client = await self._create_remote_client(http_client)

        task_id, _context_id = self._snapshot_remote_ids()
        if not task_id:
            if http_client is not None:
                try:
                    await client.close()
                except Exception:
                    logger.debug("Failed to close temporary A2A client", exc_info=True)
                try:
                    await http_client.aclose()
                except Exception:
                    logger.debug("Failed to close temporary A2A HTTP client", exc_info=True)
            raise RuntimeError("No active remote A2A task to cancel.")
        try:
            task = await client.cancel_task(CancelTaskRequest(id=task_id))
        finally:
            if http_client is not None:
                try:
                    await client.close()
                except Exception:
                    logger.debug("Failed to close temporary A2A client", exc_info=True)
                try:
                    await http_client.aclose()
                except Exception:
                    logger.debug("Failed to close temporary A2A HTTP client", exc_info=True)

        self._set_remote_ids(
            task_id=getattr(task, "id", None),
            context_id=getattr(task, "context_id", None),
        )
        self._emit_tool_messages(
            _a2a_task_messages(task),
            session_id=getattr(task, "context_id", None) or self.context_id,
        )
        self._emit_text_deltas(
            task,
            session_id=getattr(task, "context_id", None) or self.context_id,
        )
        return task

    async def send_turn(self, text: str, *, is_delegate_output: bool = True) -> dict[str, Any]:
        await self.open()
        self._rendered_tool_entries.clear()
        self._tool_names_by_call_id.clear()
        self._streamed_assistant_text = ""
        task = await self._send_text(text)
        self.context_id = getattr(task, "context_id", None) or self.context_id
        self.task_id = getattr(task, "id", None) or self.task_id
        finished = await self._wait_for_final(task)
        self.context_id = getattr(finished, "context_id", None) or self.context_id
        self.task_id = getattr(finished, "id", None) or self.task_id
        final_response = _a2a_task_text(finished)
        if final_response:
            self._set_last_assistant_text(final_response)
        if is_delegate_output and final_response:
            _emit_delegate_event(
                self.output,
                "delegate",
                "ai",
                final_response,
                session_id=self.context_id,
            )
        state = _a2a_field(getattr(finished, "status", None), "state", None)
        return {
            "task": finished,
            "final_response": final_response,
            "state": state,
            "state_name": _a2a_state_name(state),
        }

    async def _send_text(self, text: str):
        from a2a.types import Message, Part, Role, SendMessageConfiguration, SendMessageRequest

        request = SendMessageRequest(
            message=Message(
                message_id=str(uuid.uuid4()),
                role=Role.ROLE_USER,
                context_id=self.context_id or "",
                task_id="",
                parts=[Part(text=text)],
            ),
            configuration=SendMessageConfiguration(return_immediately=True),
        )
        last_task = None
        got_response = False
        async for event in self._client.send_message(request):
            got_response = True
            self._emit_tool_messages(
                _a2a_event_messages(event),
                session_id=getattr(last_task, "context_id", None) or self.context_id,
            )
            last_task = _a2a_event_to_task(event) or last_task
            if last_task is not None:
                if not self.context_id:
                    self.context_id = getattr(last_task, "context_id", None) or self.context_id
                self.task_id = getattr(last_task, "id", None) or self.task_id
                state = _a2a_field(getattr(last_task, "status", None), "state", None)
                is_final = state in _a2a_final_task_states()
                self._emit_task_text_delta(
                    last_task,
                    session_id=getattr(last_task, "context_id", None) or self.context_id,
                    is_final=is_final,
                )
                if is_final:
                    return last_task

        if not got_response:
            raise RuntimeError("A2A SDK returned no response events.")
        if last_task is None:
            raise RuntimeError("Unexpected A2A response without task or message.")
        return last_task

    async def _wait_for_final(self, task):
        from a2a.types import GetTaskRequest

        current_task = task
        deadline = time.monotonic() + self.timeout
        while True:
            self._emit_tool_messages(
                _a2a_task_messages(current_task),
                session_id=getattr(current_task, "context_id", None) or self.context_id,
            )
            state = _a2a_field(getattr(current_task, "status", None), "state", None)
            is_final = state in _a2a_final_task_states()
            self._emit_task_text_delta(
                current_task,
                session_id=getattr(current_task, "context_id", None) or self.context_id,
                is_final=is_final,
            )
            if is_final:
                return current_task
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Timed out waiting for task {getattr(current_task, 'id', None)!r}."
                )
            await asyncio.sleep(self.poll_interval)
            current_task = await self._client.get_task(GetTaskRequest(id=current_task.id))

    def _emit_task_text_delta(
        self,
        task,
        *,
        session_id: str | None,
        is_final: bool,
    ) -> None:
        if not is_final:
            self._emit_text_deltas(task, session_id=session_id)
            return

        final_text = _a2a_task_text(task)
        if not self._streamed_assistant_text or final_text.startswith(self._streamed_assistant_text):
            self._emit_text_deltas(task, session_id=session_id)
        elif final_text:
            self._set_last_assistant_text(final_text)

    def _emit_tool_messages(self, messages: list[Any], *, session_id: str | None) -> None:
        for message in messages:
            if message is None:
                continue
            for tool_call in _a2a_message_tool_calls(message):
                call_id, tool_name, arguments = _a2a_tool_call_details(tool_call)
                if call_id:
                    self._tool_names_by_call_id[call_id] = tool_name
                key = f"assistant-tool:{call_id}:{tool_name}:{arguments}"
                if key in self._rendered_tool_entries:
                    continue
                self._rendered_tool_entries.add(key)
                content = f"{tool_name} {arguments}" if arguments else tool_name
                _emit_delegate_event(
                    self.output,
                    "delegate",
                    "tool_call",
                    content,
                    session_id=session_id,
                )

            if _a2a_is_tool_message(message):
                continue

    def _emit_text_deltas(self, task, *, session_id: str | None) -> None:
        text = _a2a_task_text(task)
        if not text or text == self._streamed_assistant_text:
            return
        if self._streamed_assistant_text and text.startswith(self._streamed_assistant_text):
            delta = text[len(self._streamed_assistant_text) :]
        else:
            delta = text
        self._streamed_assistant_text = text
        self._set_last_assistant_text(text)
        if not delta:
            return
        _emit_delegate_event(
            self.output,
            "delegate",
            "ai_delta",
            delta,
            session_id=session_id,
        )


def _resolve_a2a_entry(agent_name: Optional[str]) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    name = str(agent_name or "").strip()
    if not name:
        return None, "a2a_delegate a2a mode requires a non-empty agent_name."

    loaded = _load_a2a_registry(force_refresh=False)
    entry = loaded.get(name)
    if entry is None:
        loaded = _load_a2a_registry(force_refresh=True)
        entry = loaded.get(name)
    if entry is None:
        available = ", ".join(sorted(loaded)) if loaded else "(none configured)"
        return None, f"Unknown a2a agent {name!r}. Available names: {available}."
    if not entry.get("available", False):
        details = str(entry.get("error") or "remote agent is unavailable.")
        return None, f"A2A agent {name!r} is unavailable: {details}"
    return entry, None


def _resolve_a2a_remote_url(entry: dict[str, Any]) -> str:
    agent_card = entry.get("agent_card")
    if isinstance(agent_card, dict):
        for interface in agent_card.get("supported_interfaces", []):
            if not isinstance(interface, dict):
                continue
            url = interface.get("url")
            if isinstance(url, str) and url:
                return _normalize_a2a_base_url(url)
    return _normalize_a2a_base_url(str(entry.get("url") or ""))


def _register_active_child(parent_agent, child) -> None:
    if not hasattr(parent_agent, "_active_children"):
        return
    lock = getattr(parent_agent, "_active_children_lock", None)
    if lock:
        with lock:
            parent_agent._active_children.append(child)
    else:
        parent_agent._active_children.append(child)


def _unregister_active_child(parent_agent, child) -> None:
    if not hasattr(parent_agent, "_active_children"):
        return
    lock = getattr(parent_agent, "_active_children_lock", None)
    try:
        if lock:
            with lock:
                parent_agent._active_children.remove(child)
        else:
            parent_agent._active_children.remove(child)
    except (ValueError, AttributeError):
        pass


def _build_local_child_agent(
    *,
    goal: str,
    context: Optional[str],
    toolsets: List[str],
    max_iterations: int,
    session_id: str,
    parent_agent,
):
    from run_agent import AIAgent

    workspace_hint = _resolve_workspace_hint(parent_agent)
    child_prompt = _build_child_system_prompt(
        goal,
        context,
        workspace_path=workspace_hint,
        role="leaf",
        max_spawn_depth=1,
        child_depth=1,
    )
    child = AIAgent(
        base_url=getattr(parent_agent, "base_url", None),
        api_key=getattr(parent_agent, "api_key", None),
        model=getattr(parent_agent, "model", None),
        provider=getattr(parent_agent, "provider", None),
        api_mode=getattr(parent_agent, "api_mode", None),
        max_iterations=max_iterations,
        max_tokens=getattr(parent_agent, "max_tokens", None),
        reasoning_config=getattr(parent_agent, "reasoning_config", None),
        prefill_messages=getattr(parent_agent, "prefill_messages", None),
        fallback_model=getattr(parent_agent, "_fallback_chain", None) or None,
        enabled_toolsets=toolsets,
        quiet_mode=True,
        ephemeral_system_prompt=child_prompt,
        log_prefix="[delegate-ext]",
        platform=getattr(parent_agent, "platform", None),
        session_id=session_id,
        skip_context_files=True,
        skip_memory=True,
        clarify_callback=None,
        session_db=getattr(parent_agent, "_session_db", None),
        parent_session_id=getattr(parent_agent, "session_id", None),
        providers_allowed=getattr(parent_agent, "providers_allowed", None),
        providers_ignored=getattr(parent_agent, "providers_ignored", None),
        providers_order=getattr(parent_agent, "providers_order", None),
        provider_sort=getattr(parent_agent, "provider_sort", None),
        openrouter_min_coding_score=getattr(parent_agent, "openrouter_min_coding_score", None),
        credential_pool=_resolve_child_credential_pool(
            getattr(parent_agent, "provider", None),
            parent_agent,
        ),
        pass_session_id=getattr(parent_agent, "pass_session_id", False),
    )
    child._print_fn = getattr(parent_agent, "_print_fn", None)
    child._delegate_depth = getattr(parent_agent, "_delegate_depth", 0) + 1
    child._delegate_role = "leaf"
    child._subagent_id = f"delegate-ext-{uuid.uuid4().hex[:8]}"
    child._parent_subagent_id = getattr(parent_agent, "_subagent_id", None)
    child._subagent_goal = goal
    _strip_recursive_delegate_tool(child)
    return child


def _run_local_delegate(
    *,
    goal: str,
    context: Optional[str],
    toolsets: List[str],
    max_iterations: int,
    session_id: str,
    is_delegate_output: bool,
    output,
    is_loop: bool,
    input,
    parent_agent,
) -> str:
    child = _build_local_child_agent(
        goal=goal,
        context=context,
        toolsets=toolsets,
        max_iterations=max_iterations,
        session_id=session_id,
        parent_agent=parent_agent,
    )
    _register_active_child(parent_agent, child)
    start = time.monotonic()
    old_child_stream = getattr(child, "stream_delta_callback", None)

    def _effective_child_session_id() -> str:
        return _child_session_id(child) or session_id

    def _on_child_delta(delta: str | None) -> None:
        if callable(old_child_stream):
            try:
                old_child_stream(delta)
            except Exception:
                pass
        if delta is None or not is_delegate_output:
            return
        _emit_delegate_event(
            output,
            "delegate",
            "ai_delta",
            delta,
            session_id=_effective_child_session_id(),
        )

    child.stream_delta_callback = _on_child_delta

    def _run_single_turn(user_message: str) -> dict[str, Any]:
        history = load_conversation_history(child, _effective_child_session_id())
        task_id = (
            f"delegate-ext-{uuid.uuid4().hex[:8]}"
            if getattr(parent_agent, "_current_task_id", None)
            else None
        )
        result = child.run_conversation(
            user_message=user_message,
            conversation_history=history,
            task_id=task_id,
        )
        final_response = str(result.get("final_response") or "")
        if is_delegate_output and final_response:
            _emit_delegate_event(
                output,
                "delegate",
                "ai",
                final_response,
                session_id=_effective_child_session_id(),
            )
        return result

    def _finish_loop(
        *,
        last_result: dict[str, Any],
        loop_exit_reason: str,
        success: bool = True,
        error_message: str | None = None,
        api_calls: int = 0,
    ) -> str:
        duration = round(time.monotonic() - start, 3)
        payload = {
            "success": success,
            "type": "local",
            "goal": goal,
            "session_id": _effective_child_session_id(),
            "toolsets": list(toolsets),
            "max_iterations": max_iterations,
            "is_loop": bool(is_loop),
            "completed": bool(last_result.get("completed", success)),
            "loop_exit_reason": loop_exit_reason,
            "api_calls": api_calls,
            "duration_seconds": duration,
            "final_response": str(last_result.get("final_response") or ""),
        }
        if error_message:
            payload["error"] = error_message
        return json.dumps(payload, ensure_ascii=False)

    try:
        if not is_loop:
            result = _run_single_turn(goal)
            return _finish_loop(
                last_result=result,
                loop_exit_reason="completed",
                api_calls=int(result.get("api_calls", 0) or 0),
            )

        if not _enter_delegate_foreground(input):
            return _finish_loop(
                last_result={"final_response": "", "completed": False},
                loop_exit_reason="error",
                success=False,
                error_message="a2a_delegate could not enter foreground mode.",
                api_calls=0,
            )
        _emit_delegate_event(
            output,
            "delegate",
            "status",
            "entered foreground loop",
            session_id=_effective_child_session_id(),
        )
        last_result = _run_single_turn(goal)
        total_api_calls = int(last_result.get("api_calls", 0) or 0)

        while True:
            next_message = _read_delegate_input(
                input,
                timeout=_DELEGATE_FOREGROUND_INPUT_TIMEOUT_SECONDS,
            )
            if next_message is _DELEGATE_INPUT_TIMEOUT:
                _emit_delegate_event(
                    output,
                    "delegate",
                    "status",
                    "input timeout,return to main",
                    session_id=_effective_child_session_id(),
                )
                return _finish_loop(
                    last_result=last_result,
                    loop_exit_reason="input_timeout",
                    api_calls=total_api_calls,
                )
            if next_message is None:
                return _finish_loop(
                    last_result=last_result,
                    loop_exit_reason="input_closed",
                    api_calls=total_api_calls,
                )
            assert isinstance(next_message, str)
            stripped = next_message.strip()
            if stripped in {"/main", "/exit"}:
                _emit_delegate_event(
                    output,
                    "delegate",
                    "status",
                    "return to main",
                    session_id=_effective_child_session_id(),
                )
                return _finish_loop(
                    last_result=last_result,
                    loop_exit_reason="main_command",
                    api_calls=total_api_calls,
                )
            _touch_parent_activity_for_delegate_input(parent_agent)
            last_result = _run_single_turn(stripped)
            total_api_calls += int(last_result.get("api_calls", 0) or 0)
    except Exception as exc:
        if is_delegate_output:
            _emit_delegate_event(
                output,
                "delegate",
                "error",
                str(exc),
                session_id=_effective_child_session_id(),
            )
        return _finish_loop(
            last_result={"final_response": "", "completed": False},
            loop_exit_reason="error",
            success=False,
            error_message=str(exc),
            api_calls=0,
        )
    finally:
        if is_loop:
            _exit_delegate_foreground(input)
        _unregister_active_child(parent_agent, child)
        try:
            if hasattr(child, "close"):
                child.close()
        except Exception:
            logger.debug("Failed to close delegate_ext child agent", exc_info=True)


def _build_a2a_payload(
    *,
    success: bool,
    goal: str,
    agent_name: str,
    entry: dict[str, Any],
    session: _A2ADelegateSession | None,
    is_loop: bool,
    loop_exit_reason: str,
    duration_seconds: float,
    final_response: str,
    completed: bool,
    error_message: str | None = None,
) -> str:
    payload = {
        "success": success,
        "type": "a2a",
        "agent_name": agent_name,
        "goal": goal,
        "session_id": getattr(session, "context_id", None),
        "toolsets": None,
        "max_iterations": None,
        "is_loop": bool(is_loop),
        "completed": completed,
        "loop_exit_reason": loop_exit_reason,
        "api_calls": 0,
        "duration_seconds": round(duration_seconds, 3),
        "final_response": final_response,
    }
    if error_message:
        payload["error"] = error_message
    return json.dumps(payload, ensure_ascii=False)


def _build_interrupted_a2a_payload(
    *,
    goal: str,
    agent_name: str,
    entry: dict[str, Any],
    session: _A2ADelegateSession | None,
    is_loop: bool,
    duration_seconds: float,
    last_result: dict[str, Any] | None = None,
) -> str:
    last_text = ""
    if isinstance(last_result, dict):
        last_text = str(last_result.get("final_response") or "")
    if not last_text and session is not None:
        latest_text = getattr(session, "latest_assistant_text", None)
        if callable(latest_text):
            try:
                last_text = str(latest_text() or "")
            except Exception:
                last_text = ""
    return _build_a2a_payload(
        success=True,
        goal=goal,
        agent_name=agent_name,
        entry=entry,
        session=session,
        is_loop=is_loop,
        loop_exit_reason="interrupted",
        duration_seconds=duration_seconds,
        final_response=_build_a2a_stop_final_response(last_text),
        completed=False,
    )


def _run_a2a_delegate(
    *,
    goal: str,
    agent_name: str,
    session_id: str,
    is_delegate_output: bool,
    output,
    is_loop: bool,
    input,
    parent_agent=None,
) -> str:
    start = time.monotonic()
    try:
        entry, entry_error = _resolve_a2a_entry(agent_name)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return tool_error(str(exc), success=False, type="a2a", agent_name=agent_name)
    if entry_error:
        return tool_error(entry_error, success=False, type="a2a", agent_name=agent_name)
    assert entry is not None

    session_kwargs: dict[str, Any] = {
        "output": output,
        "session_id": session_id,
    }
    if entry.get("headers"):
        session_kwargs["headers"] = dict(entry["headers"])
    session = _A2ADelegateSession(
        _resolve_a2a_remote_url(entry),
        **session_kwargs,
    )
    active_handle = _register_active_a2a_session(parent_agent, session)

    async def _run_loop() -> str:
        last_result = {"final_response": "", "state": None, "state_name": "idle"}
        entered_foreground = False
        try:
            if is_loop:
                entered_foreground = _enter_delegate_foreground(input)
                if not entered_foreground:
                    return _build_a2a_payload(
                        success=False,
                        goal=goal,
                        agent_name=agent_name,
                        entry=entry,
                        session=session,
                        is_loop=is_loop,
                        loop_exit_reason="error",
                        duration_seconds=time.monotonic() - start,
                        final_response="",
                        completed=False,
                        error_message="a2a_delegate could not enter foreground mode.",
                    )
                _emit_delegate_event(
                    output,
                    "delegate",
                    "status",
                    "entered foreground loop",
                    session_id=getattr(session, "context_id", None),
                )

            last_result = await session.send_turn(
                _decorate_a2a_user_message(goal, parent_agent),
                is_delegate_output=is_delegate_output,
            )
            if last_result.get("state") == _a2a_canceled_state():
                if is_loop:
                    _emit_delegate_event(
                        output,
                        "delegate",
                        "status",
                        "interrupted",
                        session_id=getattr(session, "context_id", None),
                    )
                return _build_interrupted_a2a_payload(
                    goal=goal,
                    agent_name=agent_name,
                    entry=entry,
                    session=session,
                    is_loop=is_loop,
                    duration_seconds=time.monotonic() - start,
                    last_result=last_result,
                )
            if not is_loop:
                state = last_result.get("state")
                completed = state == _a2a_completed_state()
                success = completed or state == _a2a_input_required_state()
                error_message = None if success else last_result.get("final_response") or last_result.get("state_name")
                return _build_a2a_payload(
                    success=success,
                    goal=goal,
                    agent_name=agent_name,
                    entry=entry,
                    session=session,
                    is_loop=is_loop,
                    loop_exit_reason="completed" if success else "error",
                    duration_seconds=time.monotonic() - start,
                    final_response=str(last_result.get("final_response") or ""),
                    completed=completed,
                    error_message=error_message,
                )

            while True:
                next_message = await asyncio.to_thread(
                    _read_delegate_input,
                    input,
                    _DELEGATE_FOREGROUND_INPUT_TIMEOUT_SECONDS,
                )
                if next_message is _DELEGATE_INPUT_TIMEOUT:
                    _emit_delegate_event(
                        output,
                        "delegate",
                        "status",
                        "input timeout",
                        session_id=getattr(session, "context_id", None),
                    )
                    return _build_a2a_payload(
                        success=True,
                        goal=goal,
                        agent_name=agent_name,
                        entry=entry,
                        session=session,
                        is_loop=is_loop,
                        loop_exit_reason="input_timeout",
                        duration_seconds=time.monotonic() - start,
                        final_response=_A2A_INPUT_TIMEOUT_MESSAGE,
                        completed=last_result.get("state") == _a2a_completed_state(),
                    )
                if next_message is None:
                    return _build_a2a_payload(
                        success=True,
                        goal=goal,
                        agent_name=agent_name,
                        entry=entry,
                        session=session,
                        is_loop=is_loop,
                        loop_exit_reason="input_closed",
                        duration_seconds=time.monotonic() - start,
                        final_response=str(last_result.get("final_response") or ""),
                        completed=last_result.get("state") == _a2a_completed_state(),
                    )

                assert isinstance(next_message, str)
                stripped = next_message.strip()
                if stripped in {"/main", "/exit"}:
                    _emit_delegate_event(
                        output,
                        "delegate",
                        "status",
                        "return to main",
                        session_id=getattr(session, "context_id", None),
                    )
                    return _build_a2a_payload(
                        success=True,
                        goal=goal,
                        agent_name=agent_name,
                        entry=entry,
                        session=session,
                        is_loop=is_loop,
                        loop_exit_reason="main_command",
                        duration_seconds=time.monotonic() - start,
                        final_response=str(last_result.get("final_response") or ""),
                        completed=last_result.get("state") == _a2a_completed_state(),
                    )

                _touch_parent_activity_for_delegate_input(parent_agent)
                last_result = await session.send_turn(
                    _decorate_a2a_user_message(stripped, parent_agent),
                    is_delegate_output=is_delegate_output,
                )
                if last_result.get("state") == _a2a_canceled_state():
                    _emit_delegate_event(
                        output,
                        "delegate",
                        "status",
                        "interrupted",
                        session_id=getattr(session, "context_id", None),
                    )
                    return _build_interrupted_a2a_payload(
                        goal=goal,
                        agent_name=agent_name,
                        entry=entry,
                        session=session,
                        is_loop=is_loop,
                        duration_seconds=time.monotonic() - start,
                        last_result=last_result,
                    )
        except Exception as exc:
            if session.should_suppress_stop_exception(exc):
                if is_delegate_output:
                    _emit_delegate_event(
                        output,
                        "delegate",
                        "status",
                        "interrupted",
                        session_id=getattr(session, "context_id", None),
                    )
                return _build_interrupted_a2a_payload(
                    goal=goal,
                    agent_name=agent_name,
                    entry=entry,
                    session=session,
                    is_loop=is_loop,
                    duration_seconds=time.monotonic() - start,
                    last_result=last_result,
                )
            if is_delegate_output:
                _emit_delegate_event(
                    output,
                    "delegate",
                    "error",
                    str(exc),
                    session_id=getattr(session, "context_id", None),
                )
            return _build_a2a_payload(
                success=False,
                goal=goal,
                agent_name=agent_name,
                entry=entry,
                session=session,
                is_loop=is_loop,
                loop_exit_reason="error",
                duration_seconds=time.monotonic() - start,
                final_response=str(last_result.get("final_response") or ""),
                completed=False,
                error_message=str(exc),
            )
        finally:
            _clear_active_a2a_session(parent_agent, active_handle)
            if entered_foreground:
                _exit_delegate_foreground(input)
            try:
                await session.close()
            except Exception as exc:
                if session.should_suppress_stop_exception(exc):
                    logger.debug("Suppressing benign A2A close exception after stop", exc_info=True)
                else:
                    raise

    return _run_coro_sync(_run_loop())


def a2a_delegate(
    goal: Optional[str] = None,
    context: Optional[str] = None,
    type: str = DEFAULT_AGENT_MODE,
    agent_name: Optional[str] = None,
    toolsets: Optional[List[str]] = None,
    max_iterations: Optional[int] = None,
    session_id: Optional[str] = None,
    is_delegate_output: bool = True,
    output=None,
    is_loop: Optional[bool] = False,
    input=None,
    parent_agent=None,
) -> str:
    """Delegate a single task to another agent."""
    if parent_agent is None:
        return tool_error("a2a_delegate requires a parent agent context.")
    if not isinstance(goal, str) or not goal.strip():
        return tool_error("a2a_delegate requires a non-empty goal.")
    effective_is_loop = is_loop if is_loop is not None else False
    if effective_is_loop and input is None:
        return tool_error("a2a_delegate loop mode requires an input adapter.")

    mode = str(type or DEFAULT_AGENT_MODE).strip().lower() or DEFAULT_AGENT_MODE
    if mode not in {"local", "a2a"}:
        return tool_error("type must be one of: local, a2a.")

    resolved_session_id = _resolve_delegate_session_id(mode, session_id)

    if mode == "a2a":
        return _run_a2a_delegate(
            goal=goal.strip(),
            agent_name=str(agent_name or "").strip(),
            session_id=resolved_session_id,
            is_delegate_output=is_delegate_output,
            output=output,
            is_loop=effective_is_loop,
            input=input,
            parent_agent=parent_agent,
        )

    normalized_toolsets, toolsets_error = _normalize_toolsets(toolsets)
    if toolsets_error:
        return tool_error(toolsets_error)
    normalized_max_iterations, max_iter_error = _normalize_max_iterations(
        max_iterations,
        parent_agent,
    )
    if max_iter_error:
        return tool_error(max_iter_error)

    return _run_local_delegate(
        goal=goal.strip(),
        context=context,
        toolsets=normalized_toolsets or list(DEFAULT_TOOLSETS),
        max_iterations=normalized_max_iterations,
        session_id=resolved_session_id,
        is_delegate_output=is_delegate_output,
        output=output,
        is_loop=effective_is_loop,
        input=input,
        parent_agent=parent_agent,
    )


A2A_DELEGATE_SCHEMA = {
    "name": "a2a_delegate",
    "description": (
        "Delegate a single task to another agent. "
        "Use a2a mode to continue a named remote agent session."
        "Use local mode to spawn a new local agent with optional toolsets and max iteration limits. "
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "goal": {
                "type": "string",
                "description": "Task goal for the delegated agent. Required.",
            },
            "context": {
                "type": "string",
                "description": "Additional context or constraints for the delegated task.",
            },
            "type": {
                "type": "string",
                "enum": ["a2a", "local"],
                "description": "Delegation target mode. Default: a2a. Use a2a for configured remote agents.",
            },
            "agent_name": {
                "type": "string",
                "description": "Configured remote A2A agent name or id. Only used when type='a2a'.",
            },
            "toolsets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Toolsets to enable for local delegated execution only. Default: ['hermes-cli']. Ignored when type='a2a'.",
            },
            "max_iterations": {
                "type": "integer",
                "minimum": 1,
                "description": "Maximum agent loop iterations for local delegated execution only. Defaults to the parent agent's limit. Ignored when type='a2a'.",
            },
            "session_id": {
                "type": "string",
                "description": "Optional child session identifier. When omitted, defaults to delegate_{profile_name}_{a2a|local}_YYYYMMDD_HHMMSS.",
            },
            "is_delegate_output": {
                "type": "boolean",
                "default": True,
                "description": "Whether delegated output should be handled as delegate output by the runtime",
            },
            "is_loop": {
                "type": "boolean",
                "default": False,
                "description": "Whether to run in interactive loop mode. Defaults to false unless explicitly enabled.",
            },
        },
        "required": ["goal","type","agent_name"],
    },
}


registry.register(
    name="a2a_list",
    toolset="a2a",
    schema=A2A_LIST_SCHEMA,
    handler=lambda args, **kw: a2a_list(),
    check_fn=check_delegate_requirements,
    emoji="🗂️",
    description="List configured remote A2A agents",
)


registry.register(
    name="a2a_delegate",
    toolset="a2a",
    schema=A2A_DELEGATE_SCHEMA,
    handler=lambda args, **kw: a2a_delegate(
        goal=args.get("goal"),
        context=args.get("context"),
        type=args.get("type", DEFAULT_AGENT_MODE),
        agent_name=args.get("agent_name"),
        toolsets=args.get("toolsets"),
        max_iterations=args.get("max_iterations"),
        session_id=args.get("session_id"),
        is_delegate_output=args.get("is_delegate_output", True),
        is_loop=args.get("is_loop", False),
        parent_agent=kw.get("parent_agent"),
    ),
    check_fn=check_delegate_requirements,
    emoji="🛰️",
    description="Delegate a single task to a local or remote agent",
)
