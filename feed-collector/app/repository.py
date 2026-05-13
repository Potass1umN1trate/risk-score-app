"""
Feed collector database repository.

All functions accept an asyncpg Pool and execute raw SQL.
No credentials are ever logged or stored in error messages.
"""

import json
import logging
import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import asyncpg

from .error_sanitizer import sanitize_error
from .models import FeedRunResult, FeedSourceConfig, NormalizedFlaggedAddress

logger = logging.getLogger(__name__)

_MAX_ERROR_LEN = 500


async def get_feed_source_by_code(
    pool: "asyncpg.Pool",
    code: str,
) -> FeedSourceConfig | None:
    row = await pool.fetchrow(
        """
        SELECT id, code, name, base_url, last_success_at, config_json
        FROM feed_sources
        WHERE code = $1 AND is_active = TRUE
        """,
        code,
    )
    if row is None:
        return None
    config_json = row["config_json"]
    if isinstance(config_json, str):
        config_json = json.loads(config_json)
    return FeedSourceConfig(
        id=row["id"],
        code=row["code"],
        name=row["name"],
        base_url=row["base_url"],
        last_success_at=row["last_success_at"],
        config_json=config_json,
    )


async def mark_feed_attempt(pool: "asyncpg.Pool", feed_source_id: str) -> None:
    await pool.execute(
        "UPDATE feed_sources SET last_attempt_at = NOW() WHERE id = $1",
        feed_source_id,
    )


async def mark_feed_success(pool: "asyncpg.Pool", feed_source_id: str) -> None:
    await pool.execute(
        "UPDATE feed_sources SET last_success_at = NOW(), last_error = NULL WHERE id = $1",
        feed_source_id,
    )


async def mark_feed_failure(
    pool: "asyncpg.Pool",
    feed_source_id: str,
    error_message: str,
) -> None:
    safe_msg = sanitize_error(error_message, max_length=_MAX_ERROR_LEN)
    await pool.execute(
        "UPDATE feed_sources SET last_error = $2 WHERE id = $1",
        feed_source_id,
        safe_msg,
    )


async def resolve_network_id(pool: "asyncpg.Pool", network_code: str) -> int | None:
    return await pool.fetchval(
        "SELECT id FROM networks WHERE code = upper($1) AND is_active = TRUE",
        network_code,
    )


async def resolve_risk_category_id(
    pool: "asyncpg.Pool",
    risk_category_code: str,
) -> int | None:
    return await pool.fetchval(
        "SELECT id FROM risk_categories WHERE code = $1",
        risk_category_code,
    )


async def upsert_flagged_address(
    pool: "asyncpg.Pool",
    network_id: int,
    address: str,
    risk_category_id: int,
    comment: str | None,
) -> str:
    new_id = str(uuid.uuid4())
    returned_id = await pool.fetchval(
        """
        INSERT INTO flagged_addresses (
            id, network_id, address, risk_category_id,
            comment, created_by_user_id, is_active
        )
        VALUES ($1, $2, $3, $4, $5, NULL, TRUE)
        ON CONFLICT (network_id, address) DO NOTHING
        RETURNING id
        """,
        new_id,
        network_id,
        address,
        risk_category_id,
        comment,
    )
    if returned_id is not None:
        return returned_id
    # Row already existed — fetch its id.
    existing_id = await pool.fetchval(
        "SELECT id FROM flagged_addresses WHERE network_id = $1 AND address = $2",
        network_id,
        address,
    )
    return existing_id


async def insert_flagged_address_source(
    pool: "asyncpg.Pool",
    flagged_address_id: str,
    feed_source_id: str,
    record: NormalizedFlaggedAddress,
) -> bool:
    new_id = str(uuid.uuid4())
    raw_payload_json = (
        json.dumps(record.raw_payload) if record.raw_payload is not None else None
    )

    if record.external_id is not None:
        # Deduplicate on (feed_source_id, external_id, flagged_address_id).
        result = await pool.execute(
            """
            INSERT INTO flagged_address_sources (
                id, flagged_address_id, feed_source_id,
                external_id, source_category, source_chain,
                confidence, trusted, checked,
                first_seen, last_seen, raw_payload_json
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()), $12)
            ON CONFLICT DO NOTHING
            """,
            new_id,
            flagged_address_id,
            feed_source_id,
            record.external_id,
            record.source_category,
            record.source_chain,
            record.confidence,
            record.trusted,
            record.checked,
            record.first_seen,
            record.last_seen,
            raw_payload_json,
        )
    else:
        # Deduplicate on (feed_source_id, flagged_address_id, source_category).
        result = await pool.execute(
            """
            INSERT INTO flagged_address_sources (
                id, flagged_address_id, feed_source_id,
                external_id, source_category, source_chain,
                confidence, trusted, checked,
                first_seen, last_seen, raw_payload_json
            )
            VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), $11)
            ON CONFLICT DO NOTHING
            """,
            new_id,
            flagged_address_id,
            feed_source_id,
            record.source_category,
            record.source_chain,
            record.confidence,
            record.trusted,
            record.checked,
            record.first_seen,
            record.last_seen,
            raw_payload_json,
        )

    # asyncpg execute() returns a status tag like "INSERT 0 1" or "INSERT 0 0".
    inserted = result.endswith(" 1")
    return inserted


async def write_audit_log(
    pool: "asyncpg.Pool",
    feed_source_id: str,
    feed_source_code: str,
    result: FeedRunResult,
) -> None:
    log_id = str(uuid.uuid4())
    details = {
        "source_code": feed_source_code,
        "fetched_count": result.fetched_count,
        "normalized_count": result.normalized_count,
        "skipped_count": result.skipped_count,
        "persisted_count": result.persisted_count,
        "evidence_inserted_count": result.evidence_inserted_count,
        "duplicate_count": result.duplicate_count,
        "record_error_count": result.record_error_count,
        "source_error_count": result.source_error_count,
        "dry_run": result.dry_run,
        "fetch_mode": result.fetch_mode,
        "fetch_since": (
            result.fetch_since.isoformat() if result.fetch_since is not None else None
        ),
        "error_samples": [
            sanitize_error(error, max_length=_MAX_ERROR_LEN)
            for error in result.errors[:10]
        ],
    }
    await pool.execute(
        """
        INSERT INTO audit_logs (
            id, user_id, actor_role, action,
            entity, entity_id, details_json
        )
        VALUES ($1, NULL, NULL, 'FEED_COLLECT', 'feed_source', $2, $3)
        """,
        log_id,
        feed_source_id,
        json.dumps(details),
    )
