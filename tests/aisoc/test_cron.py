from __future__ import annotations

def auth_headers(token: str = "test-token") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_list_cron_jobs_returns_profile_annotations(test_client, monkeypatch) -> None:
    from aisoc.backend.services import cron_service

    monkeypatch.setattr(
        cron_service,
        "list_jobs",
        lambda profile="all": [
            {"id": "job-1", "profile": "default", "profile_name": "default"}
        ],
    )
    resp = test_client.get("/api/cron/jobs", headers=auth_headers())
    assert resp.status_code == 200
    payload = resp.json()
    assert payload[0]["profile"] == "default"
