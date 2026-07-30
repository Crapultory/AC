from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from threading import Thread
from typing import Any

from aisoc.backend.services.ontology_ai_service import (
    OntologyAIError,
    OntologyAIService,
)
from aisoc.backend.services.ontology_service import OntologyError


logger = logging.getLogger(__name__)


def _env_path(name: str, default: str) -> Path:
    return Path(os.environ.get(name, default)).expanduser()


class OntologyJobService:
    """Async wrapper around AI scan: create_scan_job returns immediately with a
    job_id; a daemon thread advances the job through collect -> judge -> score
    stages and writes progress to a JSON file the client polls."""

    JOB_ROOT = _env_path(
        "AISOC_ONTOLOGY_JOBS_ROOT",
        "~/.hermes/profiles/aisoc/artifacts/ontology/jobs",
    )

    @staticmethod
    def _job_path(job_id: str) -> Path:
        OntologyJobService.JOB_ROOT.mkdir(parents=True, exist_ok=True)
        return OntologyJobService.JOB_ROOT / f"{job_id}.json"

    @staticmethod
    def _write(job_id: str, payload: dict[str, Any]) -> None:
        OntologyJobService._job_path(job_id).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def create_scan_job() -> dict[str, Any]:
        job_id = f"job-{uuid.uuid4().hex[:10]}"
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        payload = {
            "job_id": job_id,
            "status": "queued",
            "stage": "queued",
            "progress": 0.0,
            "scan_id": None,
            "output_dir": None,
            "score": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
        OntologyJobService._write(job_id, payload)
        t = Thread(target=OntologyJobService._run_scan_job, args=(job_id,), daemon=True)
        t.start()
        return payload

    @staticmethod
    def _update(job_id: str, **kwargs: Any) -> None:
        p = OntologyJobService.get_job(job_id)
        p.update(kwargs)
        p["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        OntologyJobService._write(job_id, p)

    @staticmethod
    def _run_scan_job(job_id: str) -> None:
        try:
            OntologyJobService._update(
                job_id, status="running", stage="collecting_evidence", progress=0.05
            )
            collect_result = OntologyAIService.collect()
            bundle_path = str(Path(collect_result["output_dir"]) / "evidence-bundle.json")
            OntologyJobService._update(
                job_id,
                stage="judging_with_ai",
                progress=0.4,
                current_batch=0,
                total_batches=None,
                batch_label="AI 判定准备中",
            )

            def on_batch(batch_index: int, total_batches: int) -> None:
                span = 0.34
                progress = 0.4 + (batch_index - 1) / max(total_batches, 1) * span
                OntologyJobService._update(
                    job_id,
                    stage="judging_with_ai",
                    progress=round(progress, 3),
                    current_batch=batch_index,
                    total_batches=total_batches,
                    batch_label=f"AI 判定第 {batch_index}/{total_batches} 批",
                )

            judgments_path = OntologyAIService.judge(bundle_path, progress_cb=on_batch)
            OntologyJobService._update(
                job_id,
                stage="scoring_and_gap_analysis",
                progress=0.78,
                batch_label="差异评分与聚合中",
            )
            score_result = OntologyAIService.score(judgments_path, promote_latest=True)
            score_outdir = Path(score_result["output_dir"])
            try:
                score_outdir.joinpath("judgments.runtime.json").write_text(
                    Path(judgments_path).read_text(encoding="utf-8"),
                    encoding="utf-8",
                )
            except Exception:
                logger.exception("could not persist runtime judgments to scan dir")
            OntologyJobService._update(
                job_id,
                status="completed",
                stage="completed",
                progress=1.0,
                scan_id=score_result["scan_id"],
                output_dir=score_result["output_dir"],
                score=score_result["completeness_score"],
                error=None,
                batch_label="扫描完成",
            )
        except (OntologyAIError, OntologyError) as exc:
            logger.warning("ontology scan job %s failed: %s", job_id, exc)
            OntologyJobService._update(
                job_id, status="failed", stage="failed", progress=1.0, error=str(exc), batch_label="扫描失败"
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("ontology scan job %s crashed", job_id)
            OntologyJobService._update(
                job_id,
                status="failed",
                stage="failed",
                progress=1.0,
                error=f"internal error: {exc}",
                batch_label="扫描失败",
            )

    @staticmethod
    def get_job(job_id: str) -> dict[str, Any]:
        p = OntologyJobService._job_path(job_id)
        if not p.exists():
            raise OntologyError(f"Ontology scan job not found: {job_id}")
        return json.loads(p.read_text(encoding="utf-8"))
