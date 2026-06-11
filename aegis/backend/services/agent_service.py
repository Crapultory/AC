from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from aegis.backend.models import AgentResponse, AgentUpsertRequest
from aegis.backend.services.store import AegisStore, get_aegis_store


class AgentService:
    def __init__(self, store: AegisStore | None = None) -> None:
        self._store = store or get_aegis_store()

    def list_agents(self) -> list[AgentResponse]:
        payload = self._store.read_locked()
        agents = payload["a2a"]
        return [
            self._build_agent_response(agent_id, value)
            for agent_id, value in sorted(agents.items())
        ]

    def get_agent(self, agent_id: str) -> AgentResponse:
        payload = self._store.read_locked()
        agent = payload["a2a"].get(agent_id)
        if agent is None:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
        return self._build_agent_response(agent_id, agent)

    def create_agent(self, agent_id: str, body: AgentUpsertRequest) -> AgentResponse:
        def _mutate(payload: dict[str, Any]) -> AgentResponse:
            agents = payload["a2a"]
            if agent_id in agents:
                raise HTTPException(
                    status_code=409,
                    detail=f"Agent '{agent_id}' already exists.",
                )
            agents[agent_id] = body.model_dump(mode="json")
            return self._build_agent_response(agent_id, agents[agent_id])

        return self._store.mutate_locked(_mutate)

    def update_agent(self, agent_id: str, body: AgentUpsertRequest) -> AgentResponse:
        def _mutate(payload: dict[str, Any]) -> AgentResponse:
            agents = payload["a2a"]
            if agent_id not in agents:
                raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
            agents[agent_id] = body.model_dump(mode="json")
            return self._build_agent_response(agent_id, agents[agent_id])

        return self._store.mutate_locked(_mutate)

    def delete_agent(self, agent_id: str) -> None:
        def _mutate(payload: dict[str, Any]) -> None:
            agents = payload["a2a"]
            if agent_id not in agents:
                raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")
            del agents[agent_id]
            return None

        self._store.mutate_locked(_mutate)

    @staticmethod
    def _build_agent_response(agent_id: str, payload: Mapping[str, Any]) -> AgentResponse:
        if not isinstance(payload, Mapping):
            raise HTTPException(
                status_code=500,
                detail=f"Stored agent '{agent_id}' has an invalid shape.",
            )

        try:
            return AgentResponse.model_validate({"agent_id": agent_id, **dict(payload)})
        except ValidationError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Stored agent '{agent_id}' has an invalid shape.",
            ) from exc
