from __future__ import annotations

import secrets
import string
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from aegis.backend.models import (
    GlobalRoutingRuleResponse,
    GlobalRoutingRuleUpsertRequest,
)
from aegis.backend.services.store import AegisStore, get_aegis_store


_RULE_ID_ALPHABET = string.ascii_lowercase + string.digits
_RULE_ID_LENGTH = 8
_MAX_ID_GENERATION_ATTEMPTS = 128


class RoutingService:
    def __init__(self, store: AegisStore | None = None) -> None:
        self._store = store or get_aegis_store()

    def list_global_rules(self) -> list[GlobalRoutingRuleResponse]:
        payload = self._store.read_locked()
        return [self._build_rule_response(rule) for rule in payload["global"]]

    def get_global_rule(self, rule_id: str) -> GlobalRoutingRuleResponse:
        payload = self._store.read_locked()
        for stored_rule in payload["global"]:
            if isinstance(stored_rule, Mapping) and stored_rule.get("id") == rule_id:
                return self._build_rule_response(
                    stored_rule,
                    invalid_detail=f"Stored global routing rule '{rule_id}' has an invalid shape.",
                )

        raise HTTPException(
            status_code=404,
            detail=f"Global routing rule '{rule_id}' not found.",
        )

    def create_global_rule(
        self,
        body: GlobalRoutingRuleUpsertRequest,
    ) -> GlobalRoutingRuleResponse:
        def _mutate(payload: dict[str, Any]) -> GlobalRoutingRuleResponse:
            rule_id = self._generate_rule_id(payload["global"])
            stored_rule = {"id": rule_id, **body.model_dump(mode="json")}
            payload["global"].append(stored_rule)
            return self._build_rule_response(stored_rule)

        return self._store.mutate_locked(_mutate)

    def update_global_rule(
        self,
        rule_id: str,
        body: GlobalRoutingRuleUpsertRequest,
    ) -> GlobalRoutingRuleResponse:
        def _mutate(payload: dict[str, Any]) -> GlobalRoutingRuleResponse:
            for index, stored_rule in enumerate(payload["global"]):
                if isinstance(stored_rule, Mapping) and stored_rule.get("id") == rule_id:
                    updated_rule = {"id": rule_id, **body.model_dump(mode="json")}
                    payload["global"][index] = updated_rule
                    return self._build_rule_response(updated_rule)

            raise HTTPException(
                status_code=404,
                detail=f"Global routing rule '{rule_id}' not found.",
            )

        return self._store.mutate_locked(_mutate)

    def delete_global_rule(self, rule_id: str) -> None:
        def _mutate(payload: dict[str, Any]) -> None:
            for index, stored_rule in enumerate(payload["global"]):
                if isinstance(stored_rule, Mapping) and stored_rule.get("id") == rule_id:
                    del payload["global"][index]
                    return None

            raise HTTPException(
                status_code=404,
                detail=f"Global routing rule '{rule_id}' not found.",
            )

        self._store.mutate_locked(_mutate)

    def _generate_rule_id(self, rules: list[Any]) -> str:
        existing_ids = {
            rule["id"]
            for rule in rules
            if isinstance(rule, Mapping) and isinstance(rule.get("id"), str)
        }

        for _ in range(_MAX_ID_GENERATION_ATTEMPTS):
            candidate = "".join(
                secrets.choice(_RULE_ID_ALPHABET) for _ in range(_RULE_ID_LENGTH)
            )
            if candidate not in existing_ids:
                return candidate

        raise HTTPException(
            status_code=500,
            detail="Unable to generate a unique global routing rule ID.",
        )

    @staticmethod
    def _build_rule_response(
        payload: Any,
        *,
        invalid_detail: str = "Stored global routing rule is invalid.",
    ) -> GlobalRoutingRuleResponse:
        if not isinstance(payload, Mapping):
            raise HTTPException(status_code=500, detail=invalid_detail)

        try:
            return GlobalRoutingRuleResponse.model_validate(dict(payload))
        except ValidationError as exc:
            raise HTTPException(status_code=500, detail=invalid_detail) from exc
