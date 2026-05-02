import logging
from typing import TYPE_CHECKING

from .config import FeedCollectorSettings
from .models import FeedRunResult, NormalizedFlaggedAddress
from .normalizer import normalize_feed_record
from .source_base import FeedSource

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)


def _normalize_records(
    source_code: str,
    raw_records: list,
) -> tuple[list[NormalizedFlaggedAddress], list[str]]:
    normalized: list[NormalizedFlaggedAddress] = []
    errors: list[str] = []

    for record in raw_records:
        nfa, reason = normalize_feed_record(source_code, record)
        if reason is not None:
            logger.warning(reason)
            errors.append(reason)
            continue
        if nfa is not None:
            normalized.append(nfa)

    return normalized, errors


async def run_pipeline(
    source: FeedSource,
    settings: FeedCollectorSettings,
    db_pool: "asyncpg.Pool | None" = None,
) -> FeedRunResult:
    """
    Run the feed-collector pipeline for a single source.

    dry_run=True  — normalize records and return a summary; no DB connection.
    dry_run=False — write normalized records to PostgreSQL; db_pool must be provided.
    """
    if not settings.dry_run:
        return await _run_with_db(source, settings, db_pool)
    return await _run_dry(source, settings)


async def _run_dry(
    source: FeedSource,
    settings: FeedCollectorSettings,
) -> FeedRunResult:
    available = await source.check_availability()
    if not available:
        logger.warning("Source %s is unavailable.", source.source_code)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[f"Source '{source.source_code}' reported unavailable."],
            dry_run=True,
        )

    raw_records = await source.fetch_initial(limit=settings.dummy_initial_limit)
    fetched_count = len(raw_records)

    normalized, errors = _normalize_records(source.source_code, raw_records)

    logger.info(
        "Dry-run complete for source '%s': fetched=%d normalized=%d skipped=%d",
        source.source_code,
        fetched_count,
        len(normalized),
        len(errors),
    )

    return FeedRunResult(
        source_code=source.source_code,
        fetched_count=fetched_count,
        normalized_count=len(normalized),
        skipped_count=len(errors),
        errors=errors,
        dry_run=True,
    )


async def _run_with_db(
    source: FeedSource,
    settings: FeedCollectorSettings,
    db_pool: "asyncpg.Pool | None",
) -> FeedRunResult:
    from . import repository as repo

    if db_pool is None:
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=["db_pool is required when dry_run=False but was not provided."],
            dry_run=False,
        )

    feed_source_config = await repo.get_feed_source_by_code(db_pool, source.source_code)
    if feed_source_config is None:
        logger.warning(
            "Source '%s' is not present or not active in feed_sources; skipping DB writes.",
            source.source_code,
        )
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[
                f"Source '{source.source_code}' is not configured or not active "
                f"in the feed_sources table. Add an active row before running in "
                f"non-dry-run mode."
            ],
            dry_run=False,
        )

    feed_source_id = feed_source_config.id

    await repo.mark_feed_attempt(db_pool, feed_source_id)

    available = await source.check_availability()
    if not available:
        logger.warning("Source %s is unavailable.", source.source_code)
        await repo.mark_feed_failure(
            db_pool, feed_source_id, f"Source '{source.source_code}' reported unavailable."
        )
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[f"Source '{source.source_code}' reported unavailable."],
            dry_run=False,
        )

    try:
        raw_records = await source.fetch_initial(limit=settings.dummy_initial_limit)
    except Exception as exc:
        safe_err = f"Fetch failed for source '{source.source_code}': {type(exc).__name__}"
        logger.exception("Fetch failed for source %s", source.source_code)
        await repo.mark_feed_failure(db_pool, feed_source_id, safe_err)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[safe_err],
            dry_run=False,
        )

    fetched_count = len(raw_records)
    normalized, errors = _normalize_records(source.source_code, raw_records)

    try:
        for nfa in normalized:
            network_id = await repo.resolve_network_id(db_pool, nfa.network_code)
            if network_id is None:
                msg = (
                    f"Skipped address '{nfa.address}': "
                    f"network '{nfa.network_code}' not found in DB."
                )
                logger.warning(msg)
                errors.append(msg)
                continue

            risk_category_id = await repo.resolve_risk_category_id(
                db_pool, nfa.risk_category_code
            )
            if risk_category_id is None:
                msg = (
                    f"Skipped address '{nfa.address}': "
                    f"risk category '{nfa.risk_category_code}' not found in DB."
                )
                logger.warning(msg)
                errors.append(msg)
                continue

            flagged_address_id = await repo.upsert_flagged_address(
                db_pool, network_id, nfa.address, risk_category_id, nfa.comment
            )

            await repo.insert_flagged_address_source(
                db_pool, flagged_address_id, feed_source_id, nfa
            )

    except Exception as exc:
        safe_err = (
            f"DB write failed for source '{source.source_code}': {type(exc).__name__}"
        )
        logger.exception("DB write failed for source %s", source.source_code)
        await repo.mark_feed_failure(db_pool, feed_source_id, safe_err)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=fetched_count,
            normalized_count=len(normalized),
            skipped_count=len(errors),
            errors=errors + [safe_err],
            dry_run=False,
        )

    await repo.mark_feed_success(db_pool, feed_source_id)

    result = FeedRunResult(
        source_code=source.source_code,
        fetched_count=fetched_count,
        normalized_count=len(normalized),
        skipped_count=len(errors),
        errors=errors,
        dry_run=False,
    )

    try:
        await repo.write_audit_log(db_pool, feed_source_id, source.source_code, result)
    except Exception:
        logger.exception(
            "Failed to write audit log for source %s (non-fatal)", source.source_code
        )

    logger.info(
        "Pipeline complete for source '%s': fetched=%d normalized=%d skipped=%d",
        source.source_code,
        fetched_count,
        len(normalized),
        len(errors),
    )

    return result
