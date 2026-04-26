"""
POST /api/analyze — main endpoint of the analytics service.

Implements the algorithm from the thesis flowchart (Analytics module.pdf):

  2.  Receive analysis request
  3.  Save request to DB
  4.  Fetch transaction data from the internet
  5.  Build transaction graph
  6.  Match all graph nodes against the flagged-address database
  7.  Is the KEY address found in the database?
        YES  → step 12: take threat category and risk level from DB  → step 13
        NO   → step 8:  collect numerical features from the graph
             → step 9:  build feature vector
             → step 10: apply ML model
             → step 11: get risk level prediction             → step 13
  13. Build final result
  14. Save result to DB
  15. Send result to client
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.graph.builder import GraphBuilder
from app.graph.features import extract as extract_features
from app.scoring.registry import get_scorer
from app.scoring.base import ScoreResult, score_to_risk_level
from app.db import repository as repo
from app.validators.address import validate_address
from app.blockchain.base import BlockchainRateLimitedError, BlockchainUnavailableError

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Structured error response ────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    error_code: str
    detail: str
    request_id: str | None = None


def _error(status: int, code: str, detail: str, request_id: str | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=ErrorResponse(
            error_code=code,
            detail=detail,
            request_id=request_id,
        ).model_dump(),
    )


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    address: str = Field(..., min_length=10, max_length=128, description="Wallet address")
    network: str = Field(..., description="Network code: BTC, ETH, TRX, …")
    depth: int = Field(default=2, ge=1, le=settings.max_depth)
    tx_limit: int = Field(default=50, ge=1, le=200)
    # Contradiction B: analysis period — persisted and threaded through service layer.
    # Blockchain fetchers do not yet enforce this server-side; see TODO in builder.py.
    period_days: int | None = Field(
        default=None,
        ge=1,
        le=3650,
        description="Limit analysis to transactions within the last N days (optional).",
    )

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
    # How the score was determined: "database" | "ml_model"
    scoring_method: str
    # Filled when scoring_method == "database"
    flag_type: str | None = None
    # Filled when scoring_method == "ml_model"
    nodes_count: int = 0
    edges_count: int = 0
    nodes: list[NodeOut] = []
    edges: list[EdgeOut] = []
    features: dict = {}
    analyzed_at: str


# ─── Main endpoint ────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze(body: AnalyzeRequest, request: Request):
    pool = request.app.state.db_pool

    try:
        scorer = get_scorer(body.network)
    except ValueError:
        return _error(400, "UNSUPPORTED_NETWORK", f"Unsupported network: {body.network!r}")

    # Validate address format before touching the DB or network
    addr_check = validate_address(body.network, body.address)
    if not addr_check.valid:
        return _error(400, "INVALID_ADDRESS", addr_check.reason or "Invalid address format")

    request_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # user_id is nullable — extracted from request state when an auth layer
    # populates it; falls back to None for anonymous/internal calls.
    user_id: str | None = getattr(request.state, "user_id", None)

    # Step 3 — save request to DB before any network calls
    await pool.execute(
        """
        INSERT INTO analysis_requests
            (id, user_id, address, network_code, depth, limit_tx, period_days, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', $8)
        """,
        request_id,
        user_id,
        body.address,
        body.network,
        body.depth,
        body.tx_limit,
        body.period_days,
        now,
    )

    try:
        # Steps 4–5 — fetch transactions and build graph
        builder = GraphBuilder(
            max_addresses=settings.max_addresses_per_analysis,
            tx_limit_per_address=body.tx_limit,
        )
        graph_result = await builder.build(
            root_address=body.address,
            network_code=body.network,
            depth=body.depth,
        )

        # Step 6 — match ALL graph nodes against the flagged-address DB
        # network_code is required so addresses from different blockchains
        # with identical raw strings are never conflated.
        all_addresses = [n.address for n in graph_result.nodes]
        flagged = await repo.get_flagged_addresses(pool, all_addresses, body.network)

        # Step 7 — is the KEY address itself in the DB?
        root_flag = await repo.get_address_flag(pool, body.address, body.network)

        if root_flag is not None:
            # ── Path A: key address found in DB (step 12) ──────────────────
            score_result = ScoreResult(
                score=root_flag["risk_score"],
                risk_level=root_flag["risk_level"],
                model_version="database_lookup",
                raw_probability=root_flag["risk_score"] / 100.0,
            )
            scoring_method = "database"
            features = None
            logger.info(
                "Address %s/%s found in flagged DB — flag=%s level=%s",
                body.network, body.address,
                root_flag["flag_type"], root_flag["risk_level"],
            )

        else:
            # ── Path B: unknown address — apply ML (steps 8–11) ────────────
            features = extract_features(graph_result, flagged)
            score_result = scorer.score(features)
            scoring_method = "ml_model"
            logger.info(
                "Address %s/%s scored by ML — score=%.1f level=%s",
                body.network, body.address,
                score_result.score, score_result.risk_level,
            )

        # Steps 13–14 — build result and save to DB
        result_id = await repo.save_analysis(
            pool,
            request_id=request_id,
            root_address=body.address,
            network_code=body.network,
            graph_result=graph_result,
            features=features,
            score_result=score_result,
            flagged=flagged,
            scoring_method=scoring_method,
            user_id=user_id,
        )

        await repo.mark_request_completed(pool, request_id, result_id)

    except BlockchainRateLimitedError as exc:
        logger.warning("Blockchain rate-limited for %s/%s: %s", body.network, body.address, exc)
        await repo.mark_request_failed(pool, request_id, f"BLOCKCHAIN_RATE_LIMITED: {exc}")
        return _error(429, "BLOCKCHAIN_RATE_LIMITED",
                      "Blockchain data provider is rate-limiting requests. Retry after a short wait.",
                      request_id)

    except BlockchainUnavailableError as exc:
        logger.error("Blockchain unavailable for %s/%s: %s", body.network, body.address, exc)
        await repo.mark_request_failed(pool, request_id, f"BLOCKCHAIN_UNAVAILABLE: {exc}")
        return _error(502, "BLOCKCHAIN_UNAVAILABLE",
                      "Blockchain data provider is temporarily unavailable. Try again later.",
                      request_id)

    except Exception as exc:
        logger.exception("Analysis failed for %s/%s", body.network, body.address)
        await repo.mark_request_failed(pool, request_id, type(exc).__name__)
        return _error(500, "INTERNAL_ERROR", "Analysis failed due to an internal error.", request_id)

    # Step 15 — send result to client
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
        scoring_method=scoring_method,
        flag_type=root_flag["flag_type"] if root_flag else None,
        nodes_count=len(nodes_out),
        edges_count=len(edges_out),
        nodes=nodes_out,
        edges=edges_out,
        features=features.to_dict() if features else {},
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
    from app.scoring.xgboost_scorer import UniversalXGBoostScorer

    statuses = {}
    for code, scorer in _REGISTRY.items():
        if isinstance(scorer, UniversalXGBoostScorer):
            statuses[code] = "loaded" if scorer.is_model_loaded else "heuristic_fallback"
        else:
            statuses[code] = "loaded"

    return {"models": statuses}
