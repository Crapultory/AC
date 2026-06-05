# Delegate Ext A2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a profile-local `a2a_list` discovery tool and extend `delegate_ext` so it can delegate to named remote A2A agents while preserving the existing local delegation behavior.

**Architecture:** Keep all new registry, discovery, and remote A2A execution logic inside `tools/delegate_ext_tool.py` so the module-level `A2A_REGISTRY` cache stays close to the existing delegation entrypoint. Reuse the repository's existing A2A client patterns from `tests/aisoc/test_a2a.py`, expose the new discovery tool through normal toolset wiring, and mirror the current local `delegate_ext` result envelope so `extcli` and callers do not need special-case handling.

**Tech Stack:** Python, `httpx`, `a2a-sdk`, Hermes tool registry, profile-aware Hermes home helpers, pytest

---

## File Structure

- Modify: `tools/delegate_ext_tool.py`
  - Add module-global `A2A_REGISTRY`
  - Add profile-local `a2a.json` loading helpers
  - Add agent-card fetching and capability extraction helpers
  - Add `a2a_list` tool schema + registration
  - Extend `delegate_ext` schema with `a2a_name`
  - Add remote A2A single-turn and loop execution paths
- Modify: `toolsets.py`
  - Expose `a2a_list` to the same default delegation surfaces as `delegate_ext`
- Modify: `tests/tools/test_delegate_ext.py`
  - Add coverage for registry loading, malformed config, agent-card fetch results, schema wiring, remote single-turn execution, remote loop continuity, and local-only parameter semantics

No new runtime module is needed for this feature. Keep it scoped to the existing delegation module unless implementation reveals an unavoidable separation point.

### Task 1: Add A2A Registry Contract and Tool Exposure

**Files:**
- Modify: `tools/delegate_ext_tool.py`
- Modify: `toolsets.py`
- Test: `tests/tools/test_delegate_ext.py`

- [ ] **Step 1: Write the failing contract tests for the new registry tool and schema**

```python
def test_a2a_list_schema_is_registered():
    tool = registry.get_tool("a2a_list")
    assert tool is not None
    assert tool["schema"]["name"] == "a2a_list"


def test_delegate_ext_schema_includes_a2a_name():
    props = DELEGATE_EXT_SCHEMA["parameters"]["properties"]
    assert "a2a_name" in props


def test_hermes_core_tools_include_a2a_list():
    assert "a2a_list" in _HERMES_CORE_TOOLS


def test_delegation_toolset_includes_a2a_list():
    assert "a2a_list" in TOOLSETS["delegation"]["tools"]
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pytest tests/tools/test_delegate_ext.py -k "a2a_list_schema_is_registered or schema_includes_a2a_name or include_a2a_list" -v`

Expected: FAIL because `a2a_list` is not registered yet, `delegate_ext` has no `a2a_name`, and the toolset wiring does not expose the new tool.

- [ ] **Step 3: Add the minimal tool contract and toolset wiring**

```python
A2A_REGISTRY: dict[str, dict[str, Any]] = {}


A2A_LIST_SCHEMA = {
    "name": "a2a_list",
    "description": "List profile-configured A2A agents and summarize their capabilities.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}


DELEGATE_EXT_SCHEMA["parameters"]["properties"]["a2a_name"] = {
    "type": "string",
    "description": "Configured remote A2A agent name. Only used when agent='a2a'.",
}
```

And in `toolsets.py`:

```python
_HERMES_CORE_TOOLS = [
    *[tool for tool in _HERMES_CORE_TOOLS if tool != "a2a_list"],
    "a2a_list",
]

TOOLSETS["delegation"]["tools"] = ["delegate_task", "delegate_ext", "a2a_list"]
```

- [ ] **Step 4: Re-run the targeted tests**

Run: `pytest tests/tools/test_delegate_ext.py -k "a2a_list_schema_is_registered or schema_includes_a2a_name or include_a2a_list" -v`

Expected: PASS

- [ ] **Step 5: Commit the exposure baseline**

```bash
git add tools/delegate_ext_tool.py toolsets.py tests/tools/test_delegate_ext.py
git commit -m "feat: expose a2a registry delegation tools"
```

### Task 2: Implement Profile-Local Registry Loading and Agent Card Summaries

**Files:**
- Modify: `tools/delegate_ext_tool.py`
- Test: `tests/tools/test_delegate_ext.py`

- [ ] **Step 1: Write the failing registry-loading tests**

```python
def test_a2a_list_reads_profile_local_registry(tmp_path, monkeypatch):
    hermes_home = tmp_path / "profile"
    hermes_home.mkdir()
    (hermes_home / "a2a.json").write_text(
        '{"a2a":{"test":"http://127.0.0.1/a2a"}}',
        encoding="utf-8",
    )
    monkeypatch.setattr("tools.delegate_ext_tool.get_hermes_home", lambda: hermes_home)
    monkeypatch.setattr(
        "tools.delegate_ext_tool._fetch_agent_card",
        lambda url: ({"name": "Test Agent", "capabilities": {"streaming": True}}, None),
    )

    result = json.loads(a2a_list())

    assert result["success"] is True
    assert result["count"] == 1
    assert result["agents"][0]["name"] == "test"
    assert result["agents"][0]["agent_card_name"] == "Test Agent"


def test_a2a_list_keeps_broken_agent_entries(tmp_path, monkeypatch):
    hermes_home = tmp_path / "profile"
    hermes_home.mkdir()
    (hermes_home / "a2a.json").write_text(
        '{"a2a":{"broken":"http://127.0.0.1/a2a"}}',
        encoding="utf-8",
    )
    monkeypatch.setattr("tools.delegate_ext_tool.get_hermes_home", lambda: hermes_home)
    monkeypatch.setattr(
        "tools.delegate_ext_tool._fetch_agent_card",
        lambda url: (None, "connection refused"),
    )

    result = json.loads(a2a_list())

    assert result["success"] is True
    assert result["agents"][0]["available"] is False
    assert result["agents"][0]["capabilities"] == []
    assert "connection refused" in result["agents"][0]["error"]


def test_a2a_list_fails_on_malformed_registry(tmp_path, monkeypatch):
    hermes_home = tmp_path / "profile"
    hermes_home.mkdir()
    (hermes_home / "a2a.json").write_text('{"a2a":[1,2,3]}', encoding="utf-8")
    monkeypatch.setattr("tools.delegate_ext_tool.get_hermes_home", lambda: hermes_home)

    result = json.loads(a2a_list())

    assert result["success"] is False
    assert "a2a" in result["error"].lower()
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pytest tests/tools/test_delegate_ext.py -k "reads_profile_local_registry or keeps_broken_agent_entries or fails_on_malformed_registry" -v`

Expected: FAIL because there is no profile-local loader, no capability summary extraction, and no malformed-registry handling.

- [ ] **Step 3: Implement the registry helpers and `a2a_list` handler**

```python
def _a2a_registry_path() -> Path:
    return Path(get_hermes_home()) / "a2a.json"


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
    loaded = {}
    for name, base_url in entries.items():
        card_json, error = _fetch_agent_card(str(base_url))
        loaded[name] = {
            "name": name,
            "url": str(base_url),
            "available": error is None,
            "capabilities": _extract_a2a_capabilities(card_json) if error is None else [],
            "agent_card": _summarize_agent_card(card_json) if error is None else None,
            "agent_card_name": (card_json or {}).get("name"),
            "error": error,
        }
    A2A_REGISTRY.clear()
    A2A_REGISTRY.update(loaded)
    return dict(A2A_REGISTRY)


def _fetch_agent_card(base_url: str) -> tuple[dict[str, Any] | None, str | None]:
    card_url = base_url.rstrip("/") + "/.well-known/agent-card.json"
    try:
        response = httpx.get(card_url, timeout=5.0)
        response.raise_for_status()
        return response.json(), None
    except Exception as exc:
        return None, str(exc)


def _extract_a2a_capabilities(card_json: dict[str, Any] | None) -> list[dict[str, Any]]:
    capabilities = card_json.get("capabilities") or {}
    return [
        {"name": key, "value": value}
        for key, value in capabilities.items()
    ]


def a2a_list() -> str:
    registry = _load_a2a_registry(force_refresh=True)
    return json.dumps(
        {
            "success": True,
            "count": len(registry),
            "registry_path": str(_a2a_registry_path()),
            "agents": list(registry.values()),
        },
        ensure_ascii=False,
    )
```

Implementation rules:
- use the current profile directory from `get_hermes_home()`
- treat missing `a2a.json` as an empty registry
- treat malformed top-level JSON or non-mapping `a2a` as a tool error
- preserve broken entries with `available=False`, `capabilities=[]`, and `error`
- store the structured result in `A2A_REGISTRY`

- [ ] **Step 4: Re-run the targeted tests**

Run: `pytest tests/tools/test_delegate_ext.py -k "reads_profile_local_registry or keeps_broken_agent_entries or fails_on_malformed_registry" -v`

Expected: PASS

- [ ] **Step 5: Commit the registry loader**

```bash
git add tools/delegate_ext_tool.py tests/tools/test_delegate_ext.py
git commit -m "feat: add a2a registry discovery tool"
```

### Task 3: Add Remote A2A Single-Turn Delegation

**Files:**
- Modify: `tools/delegate_ext_tool.py`
- Test: `tests/tools/test_delegate_ext.py`

- [ ] **Step 1: Write the failing remote single-turn tests**

```python
def test_a2a_mode_requires_a2a_name():
    parent = _make_mock_parent()
    result = json.loads(delegate_ext(goal="hello", agent="a2a", parent_agent=parent))
    assert "a2a_name" in result["error"]


def test_a2a_mode_ignores_local_only_parameters(monkeypatch):
    parent = _make_mock_parent()
    monkeypatch.setattr(
        "tools.delegate_ext_tool._resolve_a2a_entry",
        lambda name: {
            "name": "test",
            "url": "http://127.0.0.1/a2a",
            "available": True,
            "agent_card_name": "Remote Agent",
            "agent_card": {"name": "Remote Agent"},
            "capabilities": [],
            "error": None,
        },
    )
    monkeypatch.setattr(
        "tools.delegate_ext_tool._run_remote_a2a_single_turn",
        lambda **kwargs: {
            "session_id": "task-1",
            "final_response": "remote:done",
            "completed": True,
            "api_calls": 1,
        },
    )

    result = json.loads(
        delegate_ext(
            goal="hello",
            agent="a2a",
            a2a_name="test",
            toolsets=["terminal"],
            max_iterations=99,
            parent_agent=parent,
        )
    )

    assert result["agent"] == "a2a"
    assert result["a2a_name"] == "test"
    assert result["toolsets"] is None
    assert result["max_iterations"] is None
    assert result["agent_card_name"] == "Remote Agent"
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pytest tests/tools/test_delegate_ext.py -k "requires_a2a_name or ignores_local_only_parameters" -v`

Expected: FAIL because `a2a` mode is still a placeholder and there is no remote execution branch.

- [ ] **Step 3: Implement the remote single-turn execution path**

```python
def _resolve_a2a_entry(a2a_name: str) -> dict[str, Any] | None:
    registry = _load_a2a_registry(force_refresh=not bool(A2A_REGISTRY))
    if a2a_name in registry:
        return registry[a2a_name]
    refreshed = _load_a2a_registry(force_refresh=True)
    return refreshed.get(a2a_name)


async def _run_remote_a2a_single_turn_async(
    *,
    base_url: str,
    user_message: str,
    task_id: str | None,
    context_id: str | None,
):
    async with httpx.AsyncClient() as http_client:
        factory = ClientFactory(
            ClientConfig(httpx_client=http_client, streaming=False, polling=True)
        )
        client = await factory.create_from_url(base_url)
        request = SendMessageRequest(
            message=Message(
                message_id=str(uuid.uuid4()),
                role=Role.ROLE_USER,
                task_id=task_id or "",
                context_id=context_id or "",
                parts=[Part(text=user_message)],
            ),
            configuration=SendMessageConfiguration(return_immediately=True),
        )
        events = [event async for event in client.send_message(request)]
        if not events:
            raise RuntimeError("Remote A2A agent returned no response events.")
        first = events[0]
        if first.HasField("task"):
            task = first.task
            return {
                "session_id": task.id,
                "context_id": task.context_id,
                "final_response": task.status.message.parts[0].text,
                "completed": True,
                "api_calls": 1,
            }
        if first.HasField("message"):
            message = first.message
            return {
                "session_id": message.task_id,
                "context_id": message.context_id,
                "final_response": message.parts[0].text,
                "completed": True,
                "api_calls": 1,
            }
        raise RuntimeError("Unexpected A2A response without task or message.")


def _run_remote_a2a_single_turn(**kwargs):
    return asyncio.run(_run_remote_a2a_single_turn_async(**kwargs))
```

Implementation rules:
- validate `a2a_name` when `agent="a2a"`
- refresh registry once if the named entry is missing
- use the repository's existing `a2a.client.ClientFactory` pattern for client creation
- map the remote response into the same envelope shape as local `delegate_ext`
- set `toolsets=None` and `max_iterations=None` for remote mode
- include `remote_url` and `agent_card_name` in the remote result
- keep `is_delegate_output` behavior identical to local mode

- [ ] **Step 4: Re-run the targeted tests**

Run: `pytest tests/tools/test_delegate_ext.py -k "requires_a2a_name or ignores_local_only_parameters" -v`

Expected: PASS

- [ ] **Step 5: Commit the remote single-turn path**

```bash
git add tools/delegate_ext_tool.py tests/tools/test_delegate_ext.py
git commit -m "feat: add remote a2a delegate path"
```

### Task 4: Reuse One Remote A2A Task Across Interactive Loop Turns

**Files:**
- Modify: `tools/delegate_ext_tool.py`
- Test: `tests/tools/test_delegate_ext.py`

- [ ] **Step 1: Write the failing remote loop continuity tests**

```python
def test_a2a_loop_reuses_one_remote_task_until_main(monkeypatch):
    parent = _make_mock_parent()

    class _Input:
        def __init__(self, values):
            self._values = iter(values)
        def read_line(self):
            return next(self._values)

    calls = []

    monkeypatch.setattr(
        "tools.delegate_ext_tool._resolve_a2a_entry",
        lambda name: {
            "name": "test",
            "url": "http://127.0.0.1/a2a",
            "available": True,
            "agent_card_name": "Remote Agent",
            "agent_card": {"name": "Remote Agent"},
            "capabilities": [],
            "error": None,
        },
    )

    def _fake_remote_turn(**kwargs):
        calls.append((kwargs["user_message"], kwargs.get("task_id"), kwargs.get("context_id")))
        if len(calls) == 1:
            return {
                "session_id": "task-1",
                "context_id": "ctx-1",
                "final_response": "first",
                "completed": True,
                "api_calls": 1,
            }
        return {
            "session_id": "task-1",
            "context_id": "ctx-1",
            "final_response": "second",
            "completed": True,
            "api_calls": 1,
        }

    monkeypatch.setattr("tools.delegate_ext_tool._run_remote_a2a_single_turn", _fake_remote_turn)

    result = json.loads(
        delegate_ext(
            goal="start",
            agent="a2a",
            a2a_name="test",
            is_loop=True,
            input=_Input(["follow up", "/main"]),
            parent_agent=parent,
        )
    )

    assert result["loop_exit_reason"] == "main_command"
    assert result["final_response"] == "second"
    assert calls == [
        ("start", None, None),
        ("follow up", "task-1", "ctx-1"),
    ]


def test_a2a_loop_exit_command_matches_main(monkeypatch):
    parent = _make_mock_parent()

    class _Input:
        def __init__(self, values):
            self._values = iter(values)
        def read_line(self):
            return next(self._values)

    monkeypatch.setattr(
        "tools.delegate_ext_tool._resolve_a2a_entry",
        lambda name: {
            "name": "test",
            "url": "http://127.0.0.1/a2a",
            "available": True,
            "agent_card_name": "Remote Agent",
            "agent_card": {"name": "Remote Agent"},
            "capabilities": [],
            "error": None,
        },
    )
    monkeypatch.setattr(
        "tools.delegate_ext_tool._run_remote_a2a_single_turn",
        lambda **kwargs: {
            "session_id": "task-1",
            "context_id": "ctx-1",
            "final_response": "first",
            "completed": True,
            "api_calls": 1,
        },
    )

    result = json.loads(
        delegate_ext(
            goal="start",
            agent="a2a",
            a2a_name="test",
            is_loop=True,
            input=_Input(["/exit"]),
            parent_agent=parent,
        )
    )

    assert result["loop_exit_reason"] == "main_command"
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pytest tests/tools/test_delegate_ext.py -k "a2a_loop_reuses_one_remote_task_until_main or a2a_loop_exit_command_matches_main" -v`

Expected: FAIL because remote mode does not yet maintain one task/context across loop turns.

- [ ] **Step 3: Implement the remote loop runner**

```python
def _run_remote_a2a_delegate(
    *,
    goal: str,
    entry: dict[str, Any],
    is_delegate_output: bool,
    output,
    is_loop: bool,
    input,
):
    first = _run_remote_a2a_single_turn(
        base_url=entry["url"],
        user_message=goal,
        task_id=None,
        context_id=None,
    )
    current_task_id = first["session_id"]
    current_context_id = first.get("context_id")
    while True:
        next_message = _read_delegate_input(input)
        if next_message is None:
            return _finish_remote_result(first, "input_closed", entry)
        stripped = next_message.strip()
        if stripped in {"/main", "/exit"}:
            return _finish_remote_result(first, "main_command", entry)
        next_result = _run_remote_a2a_single_turn(
            base_url=entry["url"],
            user_message=stripped,
            task_id=current_task_id,
            context_id=current_context_id,
        )
```

Implementation rules:
- `/main` and `/exit` both return `loop_exit_reason="main_command"`
- closed input returns `loop_exit_reason="input_closed"`
- reuse one remote task/context for the whole child loop
- emit `delegate.status`, `delegate.user`, `delegate.ai`, and `delegate.error` through the existing output adapter helpers
- keep the final result envelope aligned with the local loop path

- [ ] **Step 4: Re-run the targeted tests**

Run: `pytest tests/tools/test_delegate_ext.py -k "a2a_loop_reuses_one_remote_task_until_main or a2a_loop_exit_command_matches_main" -v`

Expected: PASS

- [ ] **Step 5: Commit the remote loop implementation**

```bash
git add tools/delegate_ext_tool.py tests/tools/test_delegate_ext.py
git commit -m "feat: add remote a2a delegate loop"
```

### Task 5: Tighten Descriptions and Run the Focused Regression Suite

**Files:**
- Modify: `tools/delegate_ext_tool.py`
- Test: `tests/tools/test_delegate_ext.py`

- [ ] **Step 1: Write the failing description and discoverability tests**

```python
def test_delegate_ext_schema_marks_local_only_parameters():
    props = DELEGATE_EXT_SCHEMA["parameters"]["properties"]
    assert "only used for local" in props["toolsets"]["description"].lower()
    assert "only used for local" in props["max_iterations"]["description"].lower()
    assert "only used for a2a" in props["a2a_name"]["description"].lower()


def test_a2a_list_is_discoverable_in_delegate_toolset():
    assert "a2a_list" in TOOLSETS["delegation"]["tools"]
```

- [ ] **Step 2: Run the targeted tests to verify they fail if descriptions are stale**

Run: `pytest tests/tools/test_delegate_ext.py -k "marks_local_only_parameters or discoverable_in_delegate_toolset" -v`

Expected: FAIL because the current schema descriptions do not yet mark `toolsets` / `max_iterations` as local-only or `a2a_name` as A2A-only.

- [ ] **Step 3: Update schema descriptions and any discoverability assertions**

```python
"toolsets": {
    "description": "Toolsets to enable for local delegated execution only. Default: ['hermes-cli']. Ignored for a2a mode.",
},
"max_iterations": {
    "description": "Maximum agent loop iterations for local delegated execution only. Ignored for a2a mode.",
},
"a2a_name": {
    "description": "Configured remote A2A agent name. Only used when agent='a2a'.",
},
```

- [ ] **Step 4: Run the focused regression suite**

Run: `pytest -q tests/tools/test_delegate_ext.py`

Expected: PASS

Run: `pytest -q tests/tools/test_delegate_ext.py tests/run_agent/test_run_agent.py -k "delegate_ext or a2a_list"`

Expected: PASS

- [ ] **Step 5: Commit the final polish**

```bash
git add tools/delegate_ext_tool.py tests/tools/test_delegate_ext.py toolsets.py
git commit -m "fix: polish delegate ext a2a contract"
```

### Task 6: Final Syntax and Integration Verification

**Files:**
- Verify: `tools/delegate_ext_tool.py`
- Verify: `toolsets.py`
- Verify: `tests/tools/test_delegate_ext.py`

- [ ] **Step 1: Run Python syntax verification**

Run: `python -m py_compile tools/delegate_ext_tool.py toolsets.py`

Expected: PASS with no output

- [ ] **Step 2: Run the full focused delegate/A2A suite**

Run: `pytest -q tests/tools/test_delegate_ext.py tests/aisoc/test_a2a.py -k "delegate_ext or a2a"`

Expected: PASS with no new delegate/A2A regressions

- [ ] **Step 3: Sanity-check the final diff**

Run: `git diff -- tools/delegate_ext_tool.py toolsets.py tests/tools/test_delegate_ext.py`

Expected: Only the planned A2A registry, remote delegation, and test changes appear

- [ ] **Step 4: Commit any final cleanups**

```bash
git add tools/delegate_ext_tool.py toolsets.py tests/tools/test_delegate_ext.py
git commit -m "test: finalize delegate ext a2a coverage"
```
