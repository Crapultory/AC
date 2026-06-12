"""Aegis backend API models."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, TypeAdapter, field_validator


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
_HTTP_URL_ADAPTER = TypeAdapter(AnyHttpUrl)
_URL_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")


def normalize_agent_url(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Agent URL must be a string.")

    candidate = value.strip()
    if not candidate:
        raise ValueError("Agent URL must not be empty.")

    if not _URL_SCHEME_RE.match(candidate):
        if "/" not in candidate:
            raise ValueError("Agent URL must include a path when no scheme is provided.")
        candidate = f"http://{candidate}"

    return str(_HTTP_URL_ADAPTER.validate_python(candidate))


class AgentUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    description: str
    headers: dict[str, str]
    status: AgentStatus
    extcapabilities: list[str]

    @field_validator("url", mode="before")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return normalize_agent_url(value)


class AgentResponse(BaseModel):
    agent_id: str
    url: str
    description: str
    headers: dict[str, str]
    status: AgentStatus
    extcapabilities: list[str]

    @field_validator("url", mode="before")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return normalize_agent_url(value)


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
