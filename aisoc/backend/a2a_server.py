"""AISOC A2A server entrypoint backed by the official A2A SDK."""

from __future__ import annotations

import json
import os
from pathlib import Path

from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import (
    add_a2a_routes_to_fastapi,
    create_agent_card_routes,
    create_jsonrpc_routes,
)
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentInterface
from a2a.utils.constants import PROTOCOL_VERSION_CURRENT, TransportProtocol
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from aisoc.backend.a2a_service import HermesA2AExecutor
from aisoc.backend.agent_runtime import prepare_hermes_home
from aisoc.backend.config import AisocSettings, is_loopback_host, load_aisoc_settings

A2A_RPC_PATH = os.getenv("A2A_BASE_PATH", "/a2a")
A2A_AGENT_CARD_PATH = f"{A2A_RPC_PATH}/.well-known/agent-card.json"
print(f"A2A RPC path: {A2A_RPC_PATH}")


def build_agent_card(
    settings: AisocSettings,
    *,
    name: str | None = None,
    description: str | None = None,
    card_path: str | None = None,
    streaming: bool = False,
) -> AgentCard:
    """Build an A2A AgentCard for this server."""
    if card_path:
        data = json.loads(Path(card_path).read_text(encoding="utf-8"))
        return AgentCard(**data)

    rpc_url = f"http://{settings.host}:{settings.port}{A2A_RPC_PATH}"
    return AgentCard(
        name=name or "Hermes Agent",
        description=description or "Hermes AISOC A2A module.",
        version="0.1.0",
        capabilities=AgentCapabilities(streaming=streaming, push_notifications=False),
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        supported_interfaces=[
            AgentInterface(
                url=rpc_url,
                protocol_binding=TransportProtocol.JSONRPC,
                protocol_version=PROTOCOL_VERSION_CURRENT,
            )
        ],
        skills=[],
    )


def create_a2a_app(
    settings: AisocSettings | None = None,
    *,
    agent_factory=None,
    name: str | None = None,
    description: str | None = None,
    card_path: str | None = None,
    streaming: bool = False,
    workers: int = 4,
) -> FastAPI:
    """Create the AISOC A2A FastAPI application."""
    del workers
    active_settings = settings or load_aisoc_settings(open_browser=False)
    app = FastAPI(title="AISOC A2A")
    app.state.aisoc_settings = active_settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "module": "a2a"}

    agent_card = build_agent_card(
        active_settings,
        name=name,
        description=description,
        card_path=card_path,
        streaming=streaming,
    )
    task_store = InMemoryTaskStore()
    request_handler = DefaultRequestHandler(
        agent_executor=HermesA2AExecutor(
            agent_factory=agent_factory,
            enable_streaming=streaming,
        ),
        task_store=task_store,
        agent_card=agent_card,
    )
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=[
            *create_agent_card_routes(agent_card),
            *create_agent_card_routes(agent_card, card_url=A2A_AGENT_CARD_PATH),
        ],
        jsonrpc_routes=create_jsonrpc_routes(request_handler, rpc_url=A2A_RPC_PATH),
    )
    return app


def start_a2a_server(
    *,
    host: str = "127.0.0.1",
    port: int = 9086,
    allow_public: bool = False,
    name: str | None = None,
    description: str | None = None,
    card_path: str | None = None,
    db_path: str | None = None,
    streaming: bool = False,
    workers: int = 4,
) -> None:
    """Start the AISOC A2A server."""
    del db_path
    prepare_hermes_home()

    if not is_loopback_host(host) and not allow_public:
        raise SystemExit(
            "Refusing non-loopback bind without --insecure. "
            "Use --insecure to intentionally expose AISOC A2A on the network."
        )

    settings = load_aisoc_settings(
        host=host,
        port=port,
        open_browser=False,
        allow_public=allow_public,
        embedded_chat=False,
        dist_dir=None,
    )
    app = create_a2a_app(
        settings,
        name=name,
        description=description,
        card_path=card_path,
        streaming=streaming,
        workers=workers,
    )
    uvicorn.run(app, host=host, port=port, log_level="warning", proxy_headers=False)
