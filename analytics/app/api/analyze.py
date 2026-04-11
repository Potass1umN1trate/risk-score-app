"""
POST /api/analyze — main endpoint of the analytics service.

Pipeline:
  1. Validate request body (Pydantic)
  2. Insert analysis_requests row (status: pending → processing)
  3. Build BFS transaction graph
  4. Look up flagged addresses in the database for all graph nodes
  5. Extract feature vector from the graph
  6. Score via XGBoost (or heuristic fallback)
  7. Persist result to the database
  8. Return response to the caller
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.graph.builder import GraphBuilder
from app.graph.features import extract as extract_features
from app.scoring.registry import get_scorer
from app.db import repository as repo

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    address: str = Field(..., min_length=10, max_length=128, description="Wallet address")
    network: str = Field(..., description="Network code: BTC, ETH, TRX, …")
    depth: int = Field(default=2, ge=1, le=settings.max_depth)
    tx_limit: int = Field(default=50, ge=1, le=200)

    @field_validator("network")
    @classmethod
    def normalize_network(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("address")
    @classmethod
    def strip_address(cls, v: str) -> str:
        return v.strip()


class NodeOut(BaseModel):
    address: str
    depth: int
    is_root: bool
    is_flagged: bool
    flag_types: list[str]


class EdgeOut(BaseModel):
    from_address: str
    to_address: str
    tx_count: int
    total_amount: float


class AnalyzeResponse(BaseModel):
    request_id: str
    result_id: str
    address: str
    network: str
    risk_score: float
    risk_level: str
    model_version: str
    nodes_count: int
    edges_count: int
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    features: dict
    analyzed_at: str


# ─── Main endpoint ────────────────────────────────────────────────────────────

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(body: AnalyzeRequest, request: Request) -> AnalyzeResponse:
    """Run a full analysis cycle for an address and return the risk score."""
    pool = request.app.state.db_pool

    # Verify network is supported before touching the database
    try:
        scorer = get_scorer(body.network)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    request_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # 1. Record the request (user_id = NULL — internal service, no auth)
    await pool.execute(
        """
        INSERT INTO analysis_requests
            (id, address, network_code, depth, limit_tx, status, created_at)
        VALUES ($1, $2, $3, $4, $5, 'processing', $6)
        """,
        request_id,
        body.address,
        body.network,
        body.depth,
        body.tx_limit,
        now,
    )

    try:
        # 2. Build transaction graph
        builder = GraphBuilder(
            max_addresses=settings.max_addresses_per_analysis,
            tx_limit_per_address=body.tx_limit,
        )
        graph_result = await builder.build(
            root_address=body.address,
            network_code=body.network,
            depth=body.depth,
        )

        # 3. Look up flagged addresses for all nodes in the graph
        all_addresses = [n.address for n in graph_result.nodes]
        flagged = await repo.get_flagged_addresses(pool, all_addresses)

        # 4. Extract features
        features = extract_features(graph_result, flagged)

        # 5. Score
        score_result = scorer.score(features)

        # 6. Persist to database
        result_id = await repo.save_analysis(
            pool,
            request_id=request_id,
            root_address=body.address,
            network_code=body.network,
            graph_result=graph_result,
            features=features,
            score_result=score_result,
            flagged=flagged,
        )

        # 7. Mark request as completed
        await repo.mark_request_completed(pool, request_id, result_id)

    except Exception as exc:
        logger.exception("Analysis failed for %s/%s", body.network, body.address)
        await repo.mark_request_failed(pool, request_id, str(exc))
        raise HTTPException(status_code=500, detail=f"Analysis error: {exc}")

    # 8. Build response
    nodes_out = [
        NodeOut(
            address=n.address,
            depth=n.depth,
            is_root=n.is_root,
            is_flagged=n.address in flagged,
            flag_types=flagged.get(n.address, []),
        )
        for n in graph_result.nodes
    ]
    edges_out = [
        EdgeOut(
            from_address=e.from_address,
            to_address=e.to_address,
            tx_count=e.tx_count,
            total_amount=e.total_amount,
        )
        for e in graph_result.edges
    ]

    return AnalyzeResponse(
        request_id=request_id,
        result_id=result_id,
        address=body.address,
        network=body.network,
        risk_score=score_result.score,
        risk_level=score_result.risk_level,
        model_version=score_result.model_version,
        nodes_count=len(nodes_out),
        edges_count=len(edges_out),
        nodes=nodes_out,
        edges=edges_out,
        features=features.to_dict(),
        analyzed_at=now.isoformat(),
    )


# ─── Helper endpoints ─────────────────────────────────────────────────────────

@router.get("/networks")
async def list_networks():
    """List supported networks."""
    from app.scoring.registry import supported_networks
    return {"networks": supported_networks()}


@router.get("/model/status")
async def model_status():
    """Model load status (used by the k8s readiness probe)."""
    from app.scoring.registry import _REGISTRY
    from app.scoring.xgboost_scorer import XGBoostBitcoinScorer

    statuses = {}
    for code, scorer in _REGISTRY.items():
        if isinstance(scorer, XGBoostBitcoinScorer):
            statuses[code] = "loaded" if scorer.is_model_loaded else "heuristic_fallback"
        else:
            statuses[code] = "loaded"

    return {"models": statuses}
