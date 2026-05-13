import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .config import FeedCollectorSettings
from .error_sanitizer import sanitize_error
from .models import FeedRunResult, FeedSourceConfig, NormalizedFlaggedAddress
from .normalizer import normalize_feed_record
from .source_base import FeedSource

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)
_MAX_ERROR_SAMPLES = 10


def _append_error_sample(errors: list[str], message: object) -> None:
    if len(errors) < _MAX_ERROR_SAMPLES:
        errors.append(sanitize_error(message))


def _normalize_records(
    source_code: str,
    raw_records: list,
) -> tuple[list[NormalizedFlaggedAddress], int, list[str]]:
    normalized: list[NormalizedFlaggedAddress] = []
    errors: list[str] = []
    skipped_count = 0

    for record in raw_records:
        nfa, reason = normalize_feed_record(source_code, record)
        if reason is not None:
            skipped_count += 1
            safe_reason = sanitize_error(reason)
            logger.warning(safe_reason)
            _append_error_sample(errors, safe_reason)
            continue
        if nfa is not None:
            normalized.append(nfa)

    return normalized, skipped_count, errors


def _select_fetch_plan(
    source: FeedSource,
    feed_source_config: FeedSourceConfig,
) -> tuple[str, datetime | None]:
    if feed_source_config.last_success_at is None:
        return "initial", None
    if source.supports_time_filter:
        return "incremental", feed_source_config.last_success_at
    return "repeat_full", None


async def _fetch_records(
    source: FeedSource,
    fetch_mode: str,
    fetch_since: datetime | None,
    limit: int,
) -> list:
    if fetch_mode == "incremental":
        if fetch_since is None:
            raise ValueError("fetch_since is required for incremental fetch mode.")
        return await source.fetch_since(fetch_since, limit)
    return await source.fetch_initial(limit=limit)


async def _mark_feed_failure_safely(
    repo: Any,
    db_pool: Any,
    feed_source_id: str,
    error_message: str,
) -> None:
    try:
        await repo.mark_feed_failure(db_pool, feed_source_id, error_message)
    except Exception as exc:
        logger.warning(
            "Failed to mark feed failure for source id %s: %s",
            feed_source_id,
            sanitize_error(exc),
        )


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
    try:
        available = await source.check_availability()
    except Exception as exc:
        safe_err = sanitize_error(
            f"Availability check failed for source '{source.source_code}': "
            f"{sanitize_error(exc)}"
        )
        logger.warning("Feed source availability check failed: %s", safe_err)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[safe_err],
            dry_run=True,
            fetch_mode="initial",
            fetch_since=None,
            source_error_count=1,
        )

    if not available:
        logger.warning("Source %s is unavailable.", source.source_code)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[
                sanitize_error(f"Source '{source.source_code}' reported unavailable.")
            ],
            dry_run=True,
            fetch_mode="initial",
            fetch_since=None,
            source_error_count=1,
        )

    try:
        raw_records = await source.fetch_initial(limit=settings.dummy_initial_limit)
    except Exception as exc:
        safe_err = sanitize_error(
            f"Fetch failed for source '{source.source_code}': {sanitize_error(exc)}"
        )
        logger.warning("Feed source fetch failed: %s", safe_err)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[safe_err],
            dry_run=True,
            fetch_mode="initial",
            fetch_since=None,
            source_error_count=1,
        )

    fetched_count = len(raw_records)

    normalized, skipped_count, errors = _normalize_records(
        source.source_code, raw_records
    )

    logger.info(
        "Dry-run complete for source '%s': fetched=%d normalized=%d skipped=%d",
        source.source_code,
        fetched_count,
        len(normalized),
        skipped_count,
    )

    return FeedRunResult(
        source_code=source.source_code,
        fetched_count=fetched_count,
        normalized_count=len(normalized),
        skipped_count=skipped_count,
        errors=errors,
        dry_run=True,
        fetch_mode="initial",
        fetch_since=None,
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
            errors=[
                sanitize_error(
                    "db_pool is required when dry_run=False but was not provided."
                )
            ],
            dry_run=False,
            source_error_count=1,
        )

    try:
        feed_source_config = await repo.get_feed_source_by_code(
            db_pool, source.source_code
        )
    except Exception as exc:
        safe_err = sanitize_error(
            f"DB setup failed for source '{source.source_code}': "
            f"{sanitize_error(exc)}"
        )
        logger.warning("Feed source DB setup failed: %s", safe_err)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[safe_err],
            dry_run=False,
            source_error_count=1,
        )

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
                sanitize_error(
                    f"Source '{source.source_code}' is not configured or not active "
                    f"in the feed_sources table. Add an active row before running in "
                    f"non-dry-run mode."
                )
            ],
            dry_run=False,
            source_error_count=1,
        )

    feed_source_id = feed_source_config.id

    try:
        await repo.mark_feed_attempt(db_pool, feed_source_id)
    except Exception as exc:
        safe_err = sanitize_error(
            f"DB setup failed for source '{source.source_code}': "
            f"{sanitize_error(exc)}"
        )
        logger.warning("Feed source DB setup failed: %s", safe_err)
        await _mark_feed_failure_safely(repo, db_pool, feed_source_id, safe_err)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[safe_err],
            dry_run=False,
            source_error_count=1,
        )

    try:
        available = await source.check_availability()
    except Exception as exc:
        safe_err = sanitize_error(
            f"Availability check failed for source '{source.source_code}': "
            f"{sanitize_error(exc)}"
        )
        logger.warning("Feed source availability check failed: %s", safe_err)
        await _mark_feed_failure_safely(repo, db_pool, feed_source_id, safe_err)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[safe_err],
            dry_run=False,
            source_error_count=1,
        )

    if not available:
        logger.warning("Source %s is unavailable.", source.source_code)
        safe_err = sanitize_error(f"Source '{source.source_code}' reported unavailable.")
        await _mark_feed_failure_safely(
            repo,
            db_pool,
            feed_source_id,
            safe_err,
        )
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[safe_err],
            dry_run=False,
            source_error_count=1,
        )

    fetch_mode, fetch_since = _select_fetch_plan(source, feed_source_config)

    try:
        raw_records = await _fetch_records(
            source,
            fetch_mode,
            fetch_since,
            settings.dummy_initial_limit,
        )
    except Exception as exc:
        safe_err = sanitize_error(
            f"Fetch failed for source '{source.source_code}': {sanitize_error(exc)}"
        )
        logger.warning("Feed source fetch failed: %s", safe_err)
        await _mark_feed_failure_safely(repo, db_pool, feed_source_id, safe_err)
        return FeedRunResult(
            source_code=source.source_code,
            fetched_count=0,
            normalized_count=0,
            skipped_count=0,
            errors=[safe_err],
            dry_run=False,
            fetch_mode=fetch_mode,
            fetch_since=fetch_since,
            source_error_count=1,
        )

    fetched_count = len(raw_records)
    normalized, skipped_count, errors = _normalize_records(
        source.source_code, raw_records
    )
    persisted_count = 0
    evidence_inserted_count = 0
    duplicate_count = 0
    record_error_count = 0

    for nfa in normalized:
        try:
            network_id = await repo.resolve_network_id(db_pool, nfa.network_code)
            if network_id is None:
                msg = (
                    f"Skipped address '{nfa.address}': "
                    f"network '{nfa.network_code}' not found in DB."
                )
                safe_msg = sanitize_error(msg)
                logger.warning(safe_msg)
                skipped_count += 1
                _append_error_sample(errors, safe_msg)
                continue

            risk_category_id = await repo.resolve_risk_category_id(
                db_pool, nfa.risk_category_code
            )
            if risk_category_id is None:
                msg = (
                    f"Skipped address '{nfa.address}': "
                    f"risk category '{nfa.risk_category_code}' not found in DB."
                )
                safe_msg = sanitize_error(msg)
                logger.warning(safe_msg)
                skipped_count += 1
                _append_error_sample(errors, safe_msg)
                continue

            flagged_address_id = await repo.upsert_flagged_address(
                db_pool, network_id, nfa.address, risk_category_id, nfa.comment
            )

            evidence_inserted = await repo.insert_flagged_address_source(
                db_pool, flagged_address_id, feed_source_id, nfa
            )
            if evidence_inserted:
                evidence_inserted_count += 1
            else:
                duplicate_count += 1
            persisted_count += 1
        except Exception as exc:
            record_error_count += 1
            safe_err = sanitize_error(
                f"Record failed for source '{source.source_code}' "
                f"address '{nfa.address}': {sanitize_error(exc)}"
            )
            logger.warning("Record failed: %s", safe_err)
            _append_error_sample(errors, safe_err)
            continue

    await repo.mark_feed_success(db_pool, feed_source_id)

    result = FeedRunResult(
        source_code=source.source_code,
        fetched_count=fetched_count,
        normalized_count=len(normalized),
        skipped_count=skipped_count,
        errors=errors,
        dry_run=False,
        fetch_mode=fetch_mode,
        fetch_since=fetch_since,
        persisted_count=persisted_count,
        evidence_inserted_count=evidence_inserted_count,
        duplicate_count=duplicate_count,
        record_error_count=record_error_count,
        source_error_count=0,
    )

    try:
        await repo.write_audit_log(db_pool, feed_source_id, source.source_code, result)
    except Exception as exc:
        logger.warning(
            "Failed to write audit log for source %s (non-fatal): %s",
            source.source_code,
            sanitize_error(exc),
        )

    logger.info(
        "Pipeline complete for source '%s': fetched=%d normalized=%d skipped=%d",
        source.source_code,
        fetched_count,
        len(normalized),
        skipped_count,
    )

    return result
