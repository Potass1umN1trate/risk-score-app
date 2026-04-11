"""
Repository — the only place where the analytics service touches the database.

Schema: PostgreSQL with tables from initdb-configmap.yaml
plus the subsequent migration (added columns: depth, is_root, flag_types, …).
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


# ─── Flagged address lookup ───────────────────────────────────────────────────

async def get_flagged_addresses(
    pool: asyncpg.Pool,
    addresses: list[str],
    network_code: str = "",
) -> dict[str, list[str]]:
    """
    Returns {address: [category_code, …]} for the given address list.
    Only active records (is_active = true).
    Category code is taken from risk_categories.code.
    """
    if not addresses:
        return {}

    rows = await pool.fetch(
        """
        SELECT fa.address, rc.code AS flag_type
        FROM flagged_addresses fa
        JOIN risk_categories rc ON rc.id = fa.risk_category_id
        WHERE fa.address = ANY($1::text[])
          AND fa.is_active = true
        """,
        addresses,
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
    features: AddressFeatures,
    score_result: ScoreResult,
    flagged: dict[str, list[str]],
) -> str:
    """
    Saves the full analysis result to the database in a single transaction.
    Returns: result_id (CHAR(36)) of the newly created analysis_results row.
    """
    result_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # factors_json stores features + model metadata
    factors_json = {
        "model_version": score_result.model_version,
        "raw_probability": score_result.raw_probability,
        "features": features.to_dict(),
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
                        id, result_id, address,
                        depth, is_root, is_flagged, flag_types,
                        tags_json
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::jsonb)
                    """,
                    node_rows,
                )

            # 3. Graph edges (aggregated per address pair)
            if graph_result.edges:
                edge_rows = [
                    (
                        str(uuid.uuid4()),
                        result_id,
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
                        id, result_id,
                        from_address, to_address,
                        tx_count, amount, tx_time,
                        first_seen, last_seen
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    """,
                    edge_rows,
                )

            # 4. Feature vector (separate table for ML replay)
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
