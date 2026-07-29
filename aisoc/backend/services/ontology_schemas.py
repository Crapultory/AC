from pydantic import BaseModel, Field
from typing import List, Literal, Optional, Any


class OntologyScanResponse(BaseModel):
    scan_id: str
    output_dir: str
    score: float


class OntologyOverviewResponse(BaseModel):
    latest_scan_id: Optional[str] = None
    standard_graph_path: str
    latest_scan_path: Optional[str] = None
    score: Optional[float] = None
    status_counts: dict[str, int] = Field(default_factory=dict)
    generated_files: List[str] = Field(default_factory=list)


class OntologyRoadmapItem(BaseModel):
    node_id: str
    title: str
    domain: str
    status: Literal['partial', 'missing']
    importance_weight: float
    fulfillment_ratio: float
    priority: Literal['immediate', 'high', 'medium', 'low']
    gap_score: float = 0.0
    evidence_count: int = 0
    gap: str = ''
    action: str = ''
    assets: str = ''
    impact: str = ''
    effort: str = 'M'
    evidence_samples: List[str] = Field(default_factory=list)
    rationale: str
    recommendation: str


class OntologyRoadmapResponse(BaseModel):
    items: List[OntologyRoadmapItem]


class OntologyFilePayload(BaseModel):
    data: Any
