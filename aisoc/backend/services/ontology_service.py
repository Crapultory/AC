from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


class OntologyError(RuntimeError):
    """Generic ontology error (404-worthy: missing data, unknown artifact)."""


class OntologyBusyError(RuntimeError):
    """Compile or scan is already running; returned as 409."""


class OntologyTimeoutError(RuntimeError):
    """Compile or scan exceeded its subprocess timeout; returned as 504."""


ONTOLOGY_SUBPROCESS_TIMEOUT = int(os.environ.get("AISOC_ONTOLOGY_SUBPROCESS_TIMEOUT", "300"))

_compile_lock = threading.Lock()
_scan_lock = threading.Lock()


def _env_path(name: str, default: str) -> Path:
    return Path(os.environ.get(name, default)).expanduser()


def _run_ontology_script(script: Path, lock: threading.Lock, label: str) -> dict[str, Any]:
    """Run an ontology skill script under a single-flight lock with timeout.

    Raises OntologyBusyError if another invocation of the same label is already
    running; OntologyTimeoutError on subprocess timeout; OntologyError with a
    generic message on any other failure (details are logged, not returned)."""
    if not lock.acquire(blocking=False):
        raise OntologyBusyError(f"{label} is already in progress")
    try:
        try:
            result = subprocess.run(
                ["python3", str(script)],
                check=True,
                capture_output=True,
                text=True,
                timeout=ONTOLOGY_SUBPROCESS_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            logger.warning("ontology %s timed out after %ss", label, ONTOLOGY_SUBPROCESS_TIMEOUT)
            raise OntologyTimeoutError(f"{label} timed out after {ONTOLOGY_SUBPROCESS_TIMEOUT}s")
        except subprocess.CalledProcessError as exc:
            logger.exception("ontology %s failed (rc=%s): %s", label, exc.returncode, exc.stderr)
            raise OntologyError(f"{label} failed")
        except FileNotFoundError as exc:
            logger.exception("ontology %s missing binary or script: %s", label, exc)
            raise OntologyError(f"{label} failed")
        try:
            return json.loads(result.stdout.strip())
        except json.JSONDecodeError:
            logger.exception("ontology %s produced non-JSON output", label)
            raise OntologyError(f"{label} produced malformed output")
    finally:
        lock.release()


class OntologyService:
    STANDARD_GRAPH = _env_path(
        "AISOC_ONTOLOGY_STANDARD_GRAPH",
        "~/.hermes/profiles/aisoc/artifacts/ontology/standard/standard-graph.json",
    )
    SCANS_ROOT = _env_path(
        "AISOC_ONTOLOGY_SCANS_ROOT",
        "~/.hermes/profiles/aisoc/artifacts/ontology/scans",
    )
    SKILL_SCRIPTS = _env_path(
        "AISOC_ONTOLOGY_SKILL_SCRIPTS",
        "~/.hermes/profiles/aisoc/skills/ontology/scripts",
    )

    @staticmethod
    def _read_json(path: Path) -> Any:
        if not path.exists():
            raise OntologyError(f"Ontology artifact not found: {path}")
        return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _latest_scan_dir() -> Path:
        latest_file = OntologyService.SCANS_ROOT / "latest"
        if not latest_file.exists():
            raise OntologyError("No ontology scan has been generated yet")
        latest = Path(latest_file.read_text(encoding="utf-8").strip())
        if not latest.exists():
            raise OntologyError(f"Latest ontology scan path missing: {latest}")
        return latest

    @staticmethod
    def compile_standard_graph() -> dict[str, Any]:
        return _run_ontology_script(
            OntologyService.SKILL_SCRIPTS / "graph_compiler.py",
            _compile_lock,
            "compile",
        )

    @staticmethod
    def run_scan() -> dict[str, Any]:
        return _run_ontology_script(
            OntologyService.SKILL_SCRIPTS / "scanner.py",
            _scan_lock,
            "scan",
        )

    @staticmethod
    def get_standard_graph() -> dict[str, Any]:
        return OntologyService._read_json(OntologyService.STANDARD_GRAPH)

    @staticmethod
    def get_latest_bundle() -> dict[str, Any]:
        latest = OntologyService._latest_scan_dir()
        mapped = OntologyService._read_json(latest / "mapped-graph.json")
        scorecard = OntologyService._read_json(latest / "scorecard.json")
        gap = OntologyService._read_json(latest / "gap-report.json")
        observed = OntologyService._read_json(latest / "observed-graph.json")
        return {"latest": latest, "mapped": mapped, "scorecard": scorecard, "gap": gap, "observed": observed}

    @staticmethod
    def get_overview() -> dict[str, Any]:
        bundle = OntologyService.get_latest_bundle()
        latest = bundle["latest"]
        scorecard = bundle["scorecard"]
        mapped = bundle["mapped"]
        return {
            "latest_scan_id": latest.name,
            "standard_graph_path": str(OntologyService.STANDARD_GRAPH),
            "latest_scan_path": str(latest),
            "score": scorecard.get("completeness_score"),
            "status_counts": mapped.get("status_counts", {}),
            "generated_files": [
                str(OntologyService.STANDARD_GRAPH),
                str(latest / "observed-graph.json"),
                str(latest / "mapped-graph.json"),
                str(latest / "scorecard.json"),
                str(latest / "gap-report.json"),
            ],
        }

    @staticmethod
    def get_artifact(name: str) -> Any:
        bundle = OntologyService.get_latest_bundle()
        latest = bundle["latest"]
        if name == "standard":
            return OntologyService.get_standard_graph()
        if name == "mapped":
            return bundle["mapped"]
        if name == "scorecard":
            return bundle["scorecard"]
        if name == "gap":
            return bundle["gap"]
        if name == "observed":
            return bundle["observed"]
        raise OntologyError(f"Unknown ontology artifact: {name}")

    # NOTE: legacy REST citation endpoint deleted. The Ontology Chat page now
    # goes through /api/chat/ws + tui_gateway session (direction C), so evidence
    # citations are surfaced by the aisoc-ontology skill's own scripts, not by
    # a fixed keyword-match template here. If a future non-LLM caller needs
    # citations, resurrect ``build_chat_answer`` from git history.
    @staticmethod
    def _deprecated_build_chat_answer(query: str) -> dict[str, Any]:
        bundle = OntologyService.get_latest_bundle()
        mapped_nodes = bundle["mapped"].get("mapped_nodes", [])
        scorecard = bundle["scorecard"]
        query_l = query.lower()
        targets = []
        for node in mapped_nodes:
            text = f"{node.get('id','')} {node.get('name_zh','')} {node.get('name_en','')} {node.get('domain','')}".lower()
            if any(token in text for token in query_l.split() if token):
                targets.append(node)
        if not targets:
            targets = sorted(mapped_nodes, key=lambda x: (x.get("status") != "missing", -float(x.get("importance_weight", 0))))[:3]
        citations = []
        summaries = []
        for node in targets[:3]:
            evidence = node.get("evidence", [])
            ev = evidence[0] if evidence else {
                "source_path": "N/A",
                "confidence": "low",
                "snippet": "No direct evidence captured"
            }
            citations.append(
                {
                    "node_id": node["id"],
                    "status": node["status"],
                    "evidence_path": ev["source_path"],
                    "confidence": ev.get("confidence", "low"),
                    "reason": ev.get("snippet", ""),
                }
            )
            summaries.append(f"{node['name_zh']}({node['id']}) 当前状态为 {node['status']}，满足度 {node['fulfillment_ratio']}")
        answer = (
            f"当前 AISOC Ontology 完整度为 {scorecard.get('completeness_score')}/100。"
            + "；".join(summaries)
            + "。回答基于最近一次扫描快照与证据路径。"
        )
        return {"answer": answer, "citations": citations}

    @staticmethod
    def build_roadmap() -> dict[str, Any]:
        from aisoc.backend.services.ontology_remediation_kb import get_remediation

        bundle = OntologyService.get_latest_bundle()
        mapped_nodes = bundle["mapped"].get("mapped_nodes", [])
        candidates = [n for n in mapped_nodes if n["status"] in {"partial", "missing"}]
        candidates.sort(key=lambda n: (-float(n.get("importance_weight", 0)), float(n.get("fulfillment_ratio", 0))))
        items = []
        for node in candidates[:10]:
            weight = float(node.get("importance_weight", 0))
            ratio = float(node.get("fulfillment_ratio", 0))
            status = node["status"]
            evidence = node.get("evidence", []) or []
            ev_count = len(evidence)
            # priority: missing+high-weight => immediate; else weighted gap tiers
            gap_size = weight * (1.0 - ratio)
            if status == "missing" and weight >= 2.0:
                priority = "immediate"
            elif gap_size >= 1.2 or weight >= 2.5:
                priority = "high"
            elif gap_size >= 0.5 or weight >= 1.5:
                priority = "medium"
            else:
                priority = "low"

            kb = get_remediation(node["id"]) or {}
            name = node["name_zh"]

            # evidence-grounded status phrasing
            if status == "missing":
                status_phrase = "环境中未发现可扫描实现证据"
            elif ev_count == 0:
                status_phrase = f"已隐含存在但缺少可扫描证据（满足度 {int(ratio*100)}%）"
            else:
                status_phrase = f"已部分实现（{ev_count} 处证据，满足度 {int(ratio*100)}%）"

            gap = kb.get("gap") or f"{name} {status_phrase}，尚未标准化为可映射、可评分对象。"
            action = kb.get("action") or f"补齐 {name} 的可扫描实现证据与标准属性，建立到相邻能力的关系，使其可映射、可评分。"
            assets = kb.get("assets", "")
            impact = kb.get("impact", "")
            effort = kb.get("effort", "M")

            # sample evidence paths (dedup, top 3) so recommendation is grounded
            ev_paths = []
            seen = set()
            for e in evidence:
                p = e.get("source_path")
                if p and p not in seen:
                    seen.add(p)
                    ev_paths.append(p)
                if len(ev_paths) >= 3:
                    break

            # composite human-readable recommendation
            rec_parts = [f"【现状】{status_phrase}。", f"【缺口】{gap}", f"【建议】{action}"]
            if assets:
                rec_parts.append(f"【涉及数据源/集成】{assets}。")
            if impact:
                rec_parts.append(f"【影响】{impact}")
            recommendation = " ".join(rec_parts)

            items.append(
                {
                    "node_id": node["id"],
                    "title": name,
                    "domain": node["domain"],
                    "status": status,
                    "importance_weight": node["importance_weight"],
                    "fulfillment_ratio": node["fulfillment_ratio"],
                    "priority": priority,
                    "gap_score": round(gap_size, 2),
                    "evidence_count": ev_count,
                    "gap": gap,
                    "action": action,
                    "assets": assets,
                    "impact": impact,
                    "effort": effort,
                    "evidence_samples": ev_paths,
                    "rationale": f"权重 {node['importance_weight']} × 缺口 {round(1.0 - ratio, 2)} = 加权缺口 {round(gap_size, 2)}，优先级 {priority}。",
                    "recommendation": recommendation,
                }
            )
        return {"items": items}

