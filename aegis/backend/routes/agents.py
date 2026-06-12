"""Agent orchestration routes for Aegis backend."""

from __future__ import annotations

from fastapi import APIRouter, status

from aegis.backend.models import (
    AgentDeleteResponse,
    AgentListResponse,
    AgentResponse,
    AgentUpsertRequest,
)
from aegis.backend.services.agent_service import AgentService


def build_agents_router(service: AgentService | None = None) -> APIRouter:
    router = APIRouter(prefix="/api/agents", tags=["agents"])

    def _service() -> AgentService:
        return service or AgentService()

    @router.get("", response_model=AgentListResponse)
    async def list_agents() -> AgentListResponse:
        return AgentListResponse(agents=_service().list_agents())

    @router.get("/{agent_id}", response_model=AgentResponse)
    async def get_agent(agent_id: str) -> AgentResponse:
        return _service().get_agent(agent_id)

    @router.post(
        "/{agent_id}",
        response_model=AgentResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_agent(agent_id: str, body: AgentUpsertRequest) -> AgentResponse:
        return _service().create_agent(agent_id, body)

    @router.put("/{agent_id}", response_model=AgentResponse)
    async def update_agent(agent_id: str, body: AgentUpsertRequest) -> AgentResponse:
        return _service().update_agent(agent_id, body)

    @router.delete("/{agent_id}", response_model=AgentDeleteResponse)
    async def delete_agent(agent_id: str) -> AgentDeleteResponse:
        _service().delete_agent(agent_id)
        return AgentDeleteResponse(deleted=True, agent_id=agent_id)

    return router
