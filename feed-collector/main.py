"""
Feed Collector — standalone entry point.

Usage:
    python feed_collector/main.py            # dry-run mode (default)
    python feed_collector/main.py --dry-run  # explicit dry-run mode
    python feed_collector/main.py --no-dry-run  # live mode, DATABASE_URL required
"""

import argparse
import asyncio
import logging
import sys

from app.config import FeedCollectorSettings
from app.error_sanitizer import sanitize_error
from app.pipeline import run_pipeline
from app.source_base import FeedSource
from app.sources.chainabuse import ChainabuseSource
from app.sources.dummy import DummySource
from app.sources.ofac import OfacSource
from app.sources.scamsniffer import ScamSnifferSource


def _select_source(settings: FeedCollectorSettings) -> FeedSource:
    selected = [
        item.strip().lower()
        for item in settings.enabled_sources.split(",")
        if item.strip()
    ]
    source_code = selected[0] if selected else "dummy"

    if source_code == "chainabuse":
        return ChainabuseSource(settings)
    if source_code == "ofac":
        return OfacSource(settings)
    if source_code == "scamsniffer":
        return ScamSnifferSource(settings)
    if source_code == "dummy":
        return DummySource()

    raise ValueError(f"Unsupported feed source '{source_code}'.")


async def _main(dry_run: bool) -> int:
    settings = FeedCollectorSettings(dry_run=dry_run)

    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(levelname)s %(name)s: %(message)s",
    )

    source = _select_source(settings)

    if settings.dry_run:
        result = await run_pipeline(source, settings)
    else:
        import asyncpg

        try:
            pool = await asyncpg.create_pool(
                settings.database_url, min_size=1, max_size=3
            )
        except Exception as exc:
            print(f"Database pool creation failed: {sanitize_error(exc)}")
            return 1
        try:
            result = await run_pipeline(source, settings, db_pool=pool)
        finally:
            await pool.close()

    print(
        f"source={result.source_code} "
        f"fetched={result.fetched_count} "
        f"normalized={result.normalized_count} "
        f"skipped={result.skipped_count} "
        f"persisted={result.persisted_count} "
        f"evidence_inserted={result.evidence_inserted_count} "
        f"duplicates={result.duplicate_count} "
        f"record_errors={result.record_error_count} "
        f"source_errors={result.source_error_count} "
        f"dry_run={result.dry_run}"
    )

    if result.errors:
        for err in result.errors:
            print(f"  SKIP: {err}")

    if result.fetched_count == 0 and result.errors and "unavailable" in result.errors[0]:
        return 1

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Feed Collector pipeline")
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        default=True,
        help="Run without writing to the database (default)",
    )
    group.add_argument(
        "--no-dry-run",
        dest="dry_run",
        action="store_false",
        help="Write normalized records to the database (DATABASE_URL required)",
    )
    args = parser.parse_args()

    exit_code = asyncio.run(_main(dry_run=args.dry_run))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
