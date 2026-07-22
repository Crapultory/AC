"""Aegis backend API models."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, TypeAdapter, field_validator


UserStatus = Literal["enabled", "disabled"]


class UserResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    uid: str
    username: str
    email: str
    status: UserStatus
    create_time: str
    last_login: str | None = None
    is_admin: bool


class AuthLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class AuthLoginResponse(BaseModel):
    authenticated: bool
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


class AuthRegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    email: str = Field(min_length=5, max_length=320)


class AuthRegisterResponse(BaseModel):
    registered: bool
    status: UserStatus


class AuthSessionResponse(BaseModel):
    authenticated: bool
    user: UserResponse | None = None
    expires_in: int | None = None


class AuthLogoutResponse(BaseModel):
    logged_out: bool


class AuthPasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    old_password: str = Field(min_length=8, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class AuthPasswordChangeResponse(BaseModel):
    updated: bool


class UserCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    email: str = Field(min_length=5, max_length=320)
    status: UserStatus


class UserListResponse(BaseModel):
    users: list[UserResponse]


class UserStatusUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: UserStatus


class UserPasswordUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=8, max_length=256)


class UserPasswordUpdateResponse(BaseModel):
    updated: bool
    uid: str


class UserDeleteResponse(BaseModel):
    deleted: bool
    uid: str


class HealthResponse(BaseModel):
    status: str
    pid: int


class SystemBootstrapResponse(BaseModel):
    embedded_chat: bool
    auth_scheme: str
    admin_setup_required: bool


class SystemRestartResponse(BaseModel):
    accepted: bool
    already_requested: bool
    service: str
    pid: int


AgentStatus = Literal["active", "idle", "offline"]
GlobalRoutingStatus = Literal["active", "inactive"]
AgentPolicyStatus = Literal["allow", "deny"]
DelegateAuditStatus = Literal["succ", "fail", "auth_denied"]
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


class OverviewAgentResponse(BaseModel):
    agent_id: str
    url: str
    description: str
    status: AgentStatus
    extcapabilities: list[str]

    @field_validator("url", mode="before")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return normalize_agent_url(value)


class OverviewAgentListResponse(BaseModel):
    agents: list[OverviewAgentResponse]


class OverviewStatusCountsResponse(BaseModel):
    succ: int = Field(ge=0)
    fail: int = Field(ge=0)
    auth_denied: int = Field(ge=0)


class OverviewStatsComparisonResponse(BaseModel):
    previous_delegation_total: int = Field(ge=0)
    delegation_volume_change_percent: float | None = None
    previous_success_rate: float | None = Field(default=None, ge=0, le=1)
    success_rate_change_percentage_points: float | None = None


class OverviewStatsResponse(BaseModel):
    window_start: str
    window_end: str
    executing_agent_count: int = Field(ge=0)
    source_platform_count: int = Field(ge=0)
    active_user_count: int = Field(ge=0)
    delegation_total: int = Field(ge=0)
    success_count: int = Field(ge=0)
    success_rate: float | None = Field(default=None, ge=0, le=1)
    status_counts: OverviewStatusCountsResponse
    comparison: OverviewStatsComparisonResponse


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


class AgentPolicyUpsertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rank_id: int = Field(gt=0)
    platform: str = Field(default="*", max_length=128)
    user_id: str = Field(default="*", max_length=256)
    agent_name: str = Field(default="*", max_length=256)
    status: AgentPolicyStatus


class AgentPolicyResponse(BaseModel):
    rank_id: int = Field(gt=0)
    platform: str
    user_id: str
    agent_name: str
    status: AgentPolicyStatus


class AgentPolicyListResponse(BaseModel):
    policies: list[AgentPolicyResponse]


class AgentPolicyDeleteResponse(BaseModel):
    deleted: bool
    rank_id: int


class DelegateAuditResponse(BaseModel):
    id: str
    timestamp: str
    platform: str
    user_id: str
    user_name: str
    agent_name: str
    goal: str
    session_id: str
    is_loop: bool
    is_delegate_output: bool
    status: DelegateAuditStatus


class DelegateAuditListResponse(BaseModel):
    logs: list[DelegateAuditResponse]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
