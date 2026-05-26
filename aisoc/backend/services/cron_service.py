"""Cron service adapters."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional
import threading

from fastapi import HTTPException


_CRON_PROFILE_LOCK = threading.RLock()


def _profile_to_dict(profile_obj: Any) -> dict[str, Any]:
    return {
        "name": getattr(profile_obj, "name", "") or "default",
    }


def _fallback_profile_dicts(profiles_mod: Any) -> list[dict[str, Any]]:
    profiles_root = Path(profiles_mod.PROFILES_DIR)
    rows = [{"name": "default"}]
    if profiles_root.exists():
        for child in profiles_root.iterdir():
            if child.is_dir() and (child / "profile.yaml").exists():
                rows.append({"name": child.name})
    return rows


def _cron_profile_dicts() -> list[dict[str, Any]]:
    from hermes_cli import profiles as profiles_mod

    try:
        return [_profile_to_dict(p) for p in profiles_mod.list_profiles()]
    except Exception:
        return _fallback_profile_dicts(profiles_mod)


def _cron_profile_home(profile: Optional[str]) -> tuple[str, Path]:
    from hermes_cli import profiles as profiles_mod

    raw = (profile or "default").strip() or "default"
    try:
        canon = profiles_mod.normalize_profile_name(raw)
        profiles_mod.validate_profile_name(canon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not profiles_mod.profile_exists(canon):
        raise HTTPException(status_code=404, detail=f"Profile '{canon}' does not exist.")
    return canon, profiles_mod.get_profile_dir(canon)


def _annotate_cron_job(job: dict[str, Any], profile: str, home: Path) -> dict[str, Any]:
    annotated = dict(job)
    annotated["profile"] = profile
    annotated["profile_name"] = profile
    annotated["hermes_home"] = str(home)
    annotated["is_default_profile"] = profile == "default"
    return annotated


def _call_cron_for_profile(profile: Optional[str], func_name: str, *args, **kwargs):
    profile_name, home = _cron_profile_home(profile)
    with _CRON_PROFILE_LOCK:
        from cron import jobs as cron_jobs

        old_cron_dir = cron_jobs.CRON_DIR
        old_jobs_file = cron_jobs.JOBS_FILE
        old_output_dir = cron_jobs.OUTPUT_DIR
        cron_jobs.CRON_DIR = home / "cron"
        cron_jobs.JOBS_FILE = cron_jobs.CRON_DIR / "jobs.json"
        cron_jobs.OUTPUT_DIR = cron_jobs.CRON_DIR / "output"
        try:
            result = getattr(cron_jobs, func_name)(*args, **kwargs)
        finally:
            cron_jobs.CRON_DIR = old_cron_dir
            cron_jobs.JOBS_FILE = old_jobs_file
            cron_jobs.OUTPUT_DIR = old_output_dir

    if isinstance(result, list):
        return [_annotate_cron_job(j, profile_name, home) for j in result]
    if isinstance(result, dict):
        return _annotate_cron_job(result, profile_name, home)
    return result


def _find_cron_job_profile(job_id: str) -> str | None:
    for profile in _cron_profile_dicts():
        name = str(profile.get("name") or "")
        if not name:
            continue
        jobs = _call_cron_for_profile(name, "list_jobs", True)
        if any(j.get("id") == job_id or j.get("name") == job_id for j in jobs):
            return name
    return None


def list_jobs(profile: str = "all") -> list[dict[str, Any]]:
    requested = (profile or "all").strip()
    if requested.lower() != "all":
        return _call_cron_for_profile(requested, "list_jobs", True)

    jobs = []
    for item in _cron_profile_dicts():
        name = str(item.get("name") or "")
        if not name:
            continue
        jobs.extend(_call_cron_for_profile(name, "list_jobs", True))
    return jobs


def get_job(job_id: str, profile: str | None = None):
    selected = profile or _find_cron_job_profile(job_id)
    if not selected:
        return None
    return _call_cron_for_profile(selected, "get_job", job_id)


def create_job(profile: str, *, prompt: str, schedule: str, name: str, deliver: str):
    return _call_cron_for_profile(
        profile,
        "create_job",
        prompt=prompt,
        schedule=schedule,
        name=name,
        deliver=deliver,
    )


def update_job(job_id: str, updates: dict, profile: str | None = None):
    selected = profile or _find_cron_job_profile(job_id)
    if not selected:
        return None
    return _call_cron_for_profile(selected, "update_job", job_id, updates)


def pause_job(job_id: str, profile: str | None = None):
    selected = profile or _find_cron_job_profile(job_id)
    if not selected:
        return None
    return _call_cron_for_profile(selected, "pause_job", job_id)


def resume_job(job_id: str, profile: str | None = None):
    selected = profile or _find_cron_job_profile(job_id)
    if not selected:
        return None
    return _call_cron_for_profile(selected, "resume_job", job_id)


def trigger_job(job_id: str, profile: str | None = None):
    selected = profile or _find_cron_job_profile(job_id)
    if not selected:
        return None
    return _call_cron_for_profile(selected, "trigger_job", job_id)


def remove_job(job_id: str, profile: str | None = None) -> bool:
    selected = profile or _find_cron_job_profile(job_id)
    if not selected:
        return False
    return bool(_call_cron_for_profile(selected, "remove_job", job_id))

