"""Aegis backend API models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AuthLoginRequest(BaseModel):
    token: str = Field(default="", description="Token entered by user on login page")


class AuthLoginResponse(BaseModel):
    authenticated: bool


class AuthSessionResponse(BaseModel):
    authenticated: bool
    token_source: str


class AuthLogoutResponse(BaseModel):
    logged_out: bool


class HealthResponse(BaseModel):
    status: str


class SystemBootstrapResponse(BaseModel):
    embedded_chat: bool
    auth_scheme: str


AgentStatus = Literal["active", "idle", "offline"]


class AgentUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    description: str
    headers: dict[str, str]
    status: AgentStatus
    extcapabilities: list[str]


class AgentResponse(BaseModel):
    agent_id: str
    url: str
    description: str
    headers: dict[str, str]
    status: AgentStatus
    extcapabilities: list[str]


class AgentListResponse(BaseModel):
    agents: list[AgentResponse]


class AgentDeleteResponse(BaseModel):
    deleted: bool
    agent_id: str
