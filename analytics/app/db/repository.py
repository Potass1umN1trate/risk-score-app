"""
Repository — the only place where the analytics service touches the database.

Schema: PostgreSQL with tables from initdb-configmap.yaml
plus the subsequent migration (added columns: depth, is_root, flag_types, …).

Spec alignment notes:
- get_address_flag / get_flagged_addresses are network-aware (contradiction A).
- save_analysis persists nullable user_id for future auth integration (contradiction D).
- get_history_by_user provides user-bound history retrieval stub (contradiction D).
"""

import json
import uuid
from datetime import datetime, timezone

import asyncpg

from app.graph.builder import GraphResult
from app.graph.features import AddressFeatures
from app.scoring.base import ScoreResult


# ─── Network ID lookup ────────────────────────────────────────────────────────

async def _get_network_id(pool: asyncpg.Pool, network_code: str) -> int | None:
    row = await pool.fetchrow(
        "SELECT id FROM networks WHERE code = $1 LIMIT 1",
        network_code.upper(),
    )
    return row["id"] if row else None


# ─── Single address lookup (step 7 in the flowchart) ─────────────────────────

async def get_address_flag(
    pool: asyncpg.Pool,
    address: str,
    network_code: str,
) -> dict | None:
    """
    Check whether the root address itself is in the flagged_addresses table
    for the given network.

    Lookup is keyed by (network_id, address) — the DB unique constraint — so
    the same raw address string on different blockchains is never conflated
    (contradiction A fix).

    Returns a dict with keys {risk_level, flag_type, category_severity}
    if found and active, otherwise None.
    """
    row = await pool.fetchrow(
        """
        SELECT rc.code      AS flag_type,
               rc.severity  AS category_severity
        FROM   flagged_addresses fa
        JOIN   risk_categories   rc ON rc.id = fa.risk_category_id
        JOIN   networks          n  ON n.id  = fa.network_id
        WHERE  fa.address   = $1
          AND  n.code       = $2
          AND  fa.is_active = true
        ORDER BY rc.severity DESC
        LIMIT 1
        """,
        address,
        network_code.upper(),
    )
    if row is None:
        return None

    severity = row["category_severity"]   # 0-100
    if severity >= 60:
        risk_level = "HIGH"
    elif severity >= 25:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    return {
        "flag_type":          row["flag_type"],
        "category_severity":  severity,
        "risk_level":         risk_level,
        "risk_score":         float(severity),
    }


# ─── Flagged address lookup ───────────────────────────────────────────────────

async def get_flagged_addresses(
    pool: asyncpg.Pool,
    addresses: list[str],
    network_code: str,
) -> dict[str, list[str]]:
    """
    Returns {address: [category_code, …]} for the given address list,
    restricted to the specified network (contradiction A fix).

    Lookup filters by network_id so that the same raw address string on
    different blockchains is never treated as the same flagged entity.
    """
    if not addresses:
        return {}

    rows = await pool.fetch(
        """
        SELECT fa.address, rc.code AS flag_type
        FROM flagged_addresses fa
        JOIN risk_categories rc ON rc.id = fa.risk_category_id
        JOIN networks        n  ON n.id  = fa.network_id
        WHERE fa.address = ANY($1::text[])
          AND n.code     = $2
          AND fa.is_active = true
        """,
        addresses,
        network_code.upper(),
    )

    result: dict[str, list[str]] = {}
    for row in rows:
        result.setdefault(row["address"], []).append(row["flag_type"])
    return result


# ─── Save analysis result ─────────────────────────────────────────────────────

async def save_analysis(
    pool: asyncpg.Pool,
    *,
    request_id: str,
    root_address: str,
    network_code: str,
    graph_result: GraphResult,
    features: AddressFeatures | None,   # None when scoring_method == "database"
    score_result: ScoreResult,
    flagged: dict[str, list[str]],
    scoring_method: str = "ml_model",   # "database" | "ml_model"
    # Contradiction D: user_id is nullable — supports both authenticated and
    # anonymous/internal execution paths.
    user_id: str | None = None,
) -> str:
    """
    Saves the full analysis result to the database in a single transaction.
    Returns: result_id (CHAR(36)) of the newly created analysis_results row.
    """
    network_id = await _get_network_id(pool, network_code)
    if network_id is None:
        raise ValueError(f"Unknown network code '{network_code}' — cannot persist analysis")

    result_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # factors_json stores features + model metadata
    factors_json = {
        "scoring_method": scoring_method,
        "model_version": score_result.model_version,
        "raw_probability": score_result.raw_probability,
        "features": features.to_dict() if features else {},
    }

    async with pool.acquire() as conn:
        async with conn.transaction():

            # 1. Scoring result
            await conn.execute(
                """
                INSERT INTO analysis_results (
                    id, request_id,
                    risk_score, risk_level, factors_json,
                    address, network_code,
                    model_version, raw_probability,
                    analyzed_at, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
                """,
                result_id,
                request_id,
                score_result.score,
                score_result.risk_level,
                json.dumps(factors_json),
                root_address,
                network_code.upper(),
                score_result.model_version,
                score_result.raw_probability,
                now,
            )

            # 2. Graph nodes
            if graph_result.nodes:
                node_rows = [
                    (
                        str(uuid.uuid4()),
                        result_id,
                        network_id,
                        node.address,
                        node.depth,
                        node.is_root,
                        node.address in flagged,
                        flagged.get(node.address, []),
                        json.dumps({
                            "depth": node.depth,
                            "is_root": node.is_root,
                            "flags": flagged.get(node.address, []),
                        }),
                    )
                    for node in graph_result.nodes
                ]
                await conn.executemany(
                    """
                    INSERT INTO address_nodes (
                        id, result_id, network_id, address,
                        depth, is_root, is_flagged, flag_types,
                        tags_json
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::jsonb)
                    """,
                    node_rows,
                )

            # 3. Graph edges (aggregated per address pair)
            if graph_result.edges:
                edge_rows = [
                    (
                        str(uuid.uuid4()),
                        result_id,
                        network_id,
                        edge.from_address,
                        edge.to_address,
                        edge.tx_count,
                        edge.total_amount,
                        # tx_time = last_seen (most recent transaction)
                        datetime.fromtimestamp(edge.last_seen, tz=timezone.utc)
                        if edge.last_seen else None,
                        # first_seen / last_seen as separate columns
                        datetime.fromtimestamp(edge.first_seen, tz=timezone.utc)
                        if edge.first_seen else None,
                        datetime.fromtimestamp(edge.last_seen, tz=timezone.utc)
                        if edge.last_seen else None,
                    )
                    for edge in graph_result.edges
                ]
                await conn.executemany(
                    """
                    INSERT INTO graph_edges (
                        id, result_id, network_id,
                        from_address, to_address,
                        tx_count, amount, tx_time,
                        first_seen, last_seen
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    """,
                    edge_rows,
                )

            # 4. Feature vector — only saved when ML path was taken
            if features is not None:
                await conn.execute(
                    """
                    INSERT INTO analysis_features (id, result_id, features_json)
                    VALUES ($1, $2, $3::jsonb)
                    """,
                    str(uuid.uuid4()),
                    result_id,
                    json.dumps(features.to_dict()),
                )

    return result_id


# ─── Request status updates ───────────────────────────────────────────────────

async def mark_request_completed(
    pool: asyncpg.Pool,
    request_id: str,
    result_id: str,
) -> None:
    await pool.execute(
        """
        UPDATE analysis_requests
        SET status = 'completed', result_id = $2, completed_at = now()
        WHERE id = $1
        """,
        request_id,
        result_id,
    )


async def mark_request_failed(
    pool: asyncpg.Pool,
    request_id: str,
    error_message: str,
) -> None:
    await pool.execute(
        """
        UPDATE analysis_requests
        SET status = 'failed', error_message = $2, completed_at = now()
        WHERE id = $1
        """,
        request_id,
        error_message,
    )


# ─── User-bound history (contradiction D) ────────────────────────────────────

async def get_history_by_user(
    pool: asyncpg.Pool,
    user_id: str,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """
    Return analysis requests for a specific user, newest first.

    Provides the foundation for role-aware history queries once an auth layer
    is added (contradiction D fix). The DB index idx_analysis_requests_user
    covers (user_id, created_at DESC) for efficient retrieval.

    TODO: add role-based filtering once RBAC is implemented in the auth service.
    """
    rows = await pool.fetch(
        """
        SELECT ar.id, ar.address, ar.network_code, ar.depth, ar.limit_tx,
               ar.status, ar.result_id, ar.created_at, ar.completed_at
        FROM   analysis_requests ar
        WHERE  ar.user_id = $1
        ORDER BY ar.created_at DESC
        LIMIT  $2 OFFSET $3
        """,
        user_id,
        limit,
        offset,
    )
    return [dict(r) for r in rows]
