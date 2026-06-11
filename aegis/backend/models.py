"""Aegis backend API models."""

from __future__ import annotations

from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field


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
GlobalRoutingStatus = Literal["active", "inactive"]


class AgentUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: AnyHttpUrl
    description: str
    headers: dict[str, str]
    status: AgentStatus
    extcapabilities: list[str]


class AgentResponse(BaseModel):
    agent_id: str
    url: AnyHttpUrl
    description: str
    headers: dict[str, str]
    status: AgentStatus
    extcapabilities: list[str]


class AgentListResponse(BaseModel):
    agents: list[AgentResponse]


class AgentDeleteResponse(BaseModel):
    deleted: bool
    agent_id: str


class GlobalRoutingRuleUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    policy: str
    status: GlobalRoutingStatus


class GlobalRoutingRuleResponse(BaseModel):
    id: str = Field(min_length=8, max_length=8)
    name: str
    policy: str
    status: GlobalRoutingStatus


class GlobalRoutingRuleListResponse(BaseModel):
    rules: list[GlobalRoutingRuleResponse]


class GlobalRoutingRuleDeleteResponse(BaseModel):
    deleted: bool
    id: str
