# Feed Collector

**Stack**: Python 3.12, asyncpg
**Role**: Automated population of flagged_addresses from external sources
**Runtime**: Kubernetes CronJob (namespace risk-score-app)

---

## Implemented ✅
- DB schema for feed source configuration and evidence storage is present (`feed_sources`, `flagged_address_sources`).
- Six known feed sources are seeded in `feed_sources` (chainabuse, ofac, trm_sanctions, scamsniffer, bitcoinabuse, cryptoscamdb).
- Standalone Python skeleton (`feed_collector/`) with dry-run pipeline — no DB writes, no external API calls:
  - `feed_collector/app/config.py` — `FeedCollectorSettings` via pydantic-settings; `database_url` optional when `dry_run=True`; required (model_validator raises) when `dry_run=False`; `dry_run=True` default; `dummy_initial_limit`, `enabled_sources`, `log_level`.
  - `feed_collector/app/models.py` — `FeedSourceConfig`, source-native `RawFeedRecord`, internal `NormalizedFlaggedAddress` with preserved evidence metadata (`source_chain`, `source_category`, `trusted`, `checked`, `first_seen`, `last_seen`, `raw_payload`), `FeedRunResult` dataclasses.
  - `feed_collector/app/source_base.py` — abstract `FeedSource` interface: `source_code`, `check_availability()`, `supports_time_filter`, `fetch_initial(limit)`, `fetch_since(since, limit)`.
  - `feed_collector/app/mappings.py` — explicit source-aware mappings from feed-native chain/category values to project codes. Implemented for `dummy` and mapping-only future `chainabuse`; no Chainabuse client or external calls.
  - `feed_collector/app/normalizer.py` — supported project network set (BTC/ETH/TRX/SOL/BNB/XRP/LTC/DOGE/ADA/TON); `normalize_feed_record(source_code, record)` maps source-native chain/category values, strips addresses, lowercases ETH/BNB, preserves evidence metadata, and deterministically skips missing-address/unsupported-chain/unsupported-network/unsupported-category records. Regex validation remains deferred.
  - `feed_collector/app/sources/dummy.py` — `DummySource`: `source_code="dummy"`, always available, `supports_time_filter=False`, `fetch_initial` returns 3 source-native hardcoded records (BTC scam, ETH phishing, FAKECHAIN scam to exercise skip path), `fetch_since` returns `[]`; no network calls.
  - `feed_collector/app/pipeline.py` — `run_pipeline(source, settings, db_pool=None) -> FeedRunResult`; `dry_run=True` path: checks availability, fetches initial records, normalizes source-native records through `normalize_feed_record`, returns summary, never connects to DB; `dry_run=False` path: requires `db_pool`, looks up `feed_sources` by `source_code`, marks attempt, fetches initial records, normalizes, resolves mapped network/category ids, upserts `flagged_addresses` and inserts `flagged_address_sources`, marks success or failure, writes `FEED_COLLECT` audit log; if source code is not present/active in `feed_sources`, returns an error result without fetching.
  - `feed_collector/app/repository.py` — asyncpg-based repository: `get_feed_source_by_code`, `mark_feed_attempt`, `mark_feed_success`, `mark_feed_failure`, `resolve_network_id`, `resolve_risk_category_id`, `upsert_flagged_address` (INSERT … ON CONFLICT DO NOTHING + SELECT fallback), `insert_flagged_address_source` (ON CONFLICT DO NOTHING, branches on `external_id`, stores preserved evidence fields), `write_audit_log`.
  - `feed_collector/main.py` — CLI entry point; `--dry-run` (default) / `--no-dry-run`; `--no-dry-run` creates asyncpg pool from `settings.database_url`, passes it to `run_pipeline`, closes pool reliably; never prints credentials.
  - 43 unit tests in `feed_collector/tests/` covering models, source mappings, normalizer behavior, DummySource, and full dry-run pipeline; zero DB/network dependency.
  - 19 Postgres integration tests in `feed_collector/tests/test_repository_postgres_integration.py` (skipped without `TEST_DATABASE_URL`): repository function coverage, full `dry_run=False` end-to-end with DummySource, missing-source error path.
  - **`dry_run=True` does not connect to DB.** `dry_run=False` requires `DATABASE_URL` (enforced by config validator) and writes to `flagged_addresses`, `flagged_address_sources`, `feed_sources` sync columns, and `audit_logs`.
  - **`feed_sources` must contain an active row for `source_code` before DB writes occur.** If the row is missing or inactive, the pipeline returns an error result immediately without fetching records.
  - Verified (2026-05-02): dry-run runs cleanly (`fetched=3 normalized=2 skipped=1 dry_run=True`); config raises `ValidationError` when `dry_run=False` and `database_url=None`; 43 unit tests pass; 19 integration tests are present and skipped unless `TEST_DATABASE_URL` is set.

## NOT Implemented ❌
- [ ] Kubernetes CronJob manifest for feed-collector (`k8s/feed-collector/` is empty)
- [ ] Incremental fetch logic (`fetch_since` path based on `last_success_at`; iteration 2/3 runtime still always calls `fetch_initial`)
- [ ] Real source integrations: Chainabuse, OFAC/SDN, TRM Sanctions, ScamSniffer, BitcoinAbuse, CryptoScamDB
- [ ] Full per-network address regex validation in normalizer (currently only whitespace-strip + ETH/BNB lowercase)
- [ ] Docker container / Dockerfile for feed-collector

---

## Algorithm
```
1.  Query feed_sources WHERE is_active = TRUE, ordered by last_attempt_at ASC NULLS FIRST
2.  For each source:
    a. Set feed_sources.last_attempt_at = NOW()
    b. Check source availability
       UNAVAILABLE → set feed_sources.last_error, log, skip to next source
    c. Fetch initial records (`fetch_initial`). Iteration 2/3 runtime always uses
       `fetch_initial`; initial-vs-incremental source sync using `last_success_at`
       is planned for a future iteration.
    d. For each fetched address record:
       - Map source-native `source_chain` to an internal project network code
       - UNKNOWN/UNSUPPORTED NETWORK → log and skip the record
       - Map source-native `source_category` to an internal risk_categories.code
       - UNKNOWN/UNSUPPORTED CATEGORY → log and skip the record
       - Normalize address format for the mapped network
       - Upsert flagged_addresses:
           ON CONFLICT (network_id, address) DO NOTHING
           (deduplication — never overwrite an existing canonical record)
         On insert: set created_by_user_id = NULL (system record)
       - Resolve the flagged_address_id (by network_id + address)
       - Insert flagged_address_sources evidence row:
           ON CONFLICT DO NOTHING (iteration 2 — no update of existing evidence rows)
           (future iteration: DO UPDATE SET last_seen = ..., raw_payload_json = ..., updated_at = NOW())
    e. Set feed_sources.last_success_at = NOW(), last_error = NULL
3.  Log each source run to audit_logs (action: FEED_COLLECT, entity: feed_source, entity_id: feed_sources.id)
```

---

## Data Contract with DB

### Reads from:
- `feed_sources` — source configuration and sync state (`is_active`, `last_success_at`, `config_json`)
- `networks` — to resolve `network_id` by code
- `flagged_addresses` — deduplication by `(network_id, address)`

### Writes to:
- `flagged_addresses` — inserts new canonical records; never updates or deactivates existing rows
- `flagged_address_sources` — inserts new evidence rows only; existing rows are not updated (iteration 2)
- `feed_sources` — updates `last_attempt_at`, `last_success_at`, `last_error` after each run
- `audit_logs` — one `FEED_COLLECT` event per source run

### Source-native record contract:
- `RawFeedRecord.address` — source-provided address string; nullable so malformed feed rows can be represented and skipped deterministically
- `RawFeedRecord.source_chain` — source-native chain/network value, e.g. `TRON`, `BINANCE`, `BTC`
- `RawFeedRecord.source_category` — source-native risk category, e.g. `RUG_PULL`, `PHISHING`, `scam`
- Optional evidence metadata: `external_id`, `confidence`, `trusted`, `checked`, `first_seen`, `last_seen`, `raw_payload`

### Mapping contract:
- Supported project network codes: `BTC`, `ETH`, `TRX`, `SOL`, `BNB`, `XRP`, `LTC`, `DOGE`, `ADA`, `TON`
- `dummy` chains: `BTC → BTC`, `ETH → ETH`, `FAKECHAIN → skip`
- `dummy` categories: `scam → scam`, `phishing → phishing`, `suspicious → suspicious`
- `chainabuse` mapping support is mapping-only for future source work; no Chainabuse client is implemented.
- Future Chainabuse chains: `BTC → BTC`, `ETH → ETH`, `TRON → TRX`, `SOL → SOL`, `BINANCE → BNB`, `LITECOIN → LTC`, `CARDANO → ADA`, `TON → TON`; known but unseeded project networks such as `POLYGON`, `HBAR`, `AVALANCHE`, `MULTIVERSX`, `ARBITRUM`, `ALGORAND`, `BASE` map to skip for now; `XRP` and `DOGE` map to skip for Chainabuse per the provided contract.
- Future Chainabuse categories: `PHISHING → phishing`, `RANSOMWARE → ransomware`; investment/social scam group maps to `scam`; exploit/other/null/unknown group maps to `suspicious`.
- All mappings are case-insensitive and trim surrounding whitespace.

### Sync state fields (feed_sources):
- `last_attempt_at` — set at the start of each source run (before any fetch)
- `last_success_at` — set at end of run only when the fetch completed without error; reserved for future incremental-fetch cursor logic
- `last_error` — set on failure; cleared on success

### System-created records:
- `flagged_addresses.created_by_user_id = NULL` for all feed-collector-inserted rows
- `flagged_address_sources.feed_source_id` always references a `feed_sources` row

### Deduplication:
- Canonical record: `(network_id, address)` — never insert duplicate pair into `flagged_addresses`
- Evidence record: `(feed_source_id, external_id, flagged_address_id)` when `external_id` is set; `(feed_source_id, flagged_address_id, source_category)` otherwise

---

## Constraints
- ❌ NEVER delete or deactivate existing `flagged_addresses` records
- ❌ NEVER insert duplicate `(network_id, address)` pairs
- ✅ `created_by_user_id = NULL` for all feed-collector-inserted `flagged_addresses` rows
- ✅ Unavailable source → set `last_error`, log, skip and continue — do not crash the job
- ✅ Log each source run to `audit_logs` (action: `FEED_COLLECT`)
- ❌ Initial vs incremental source sync is not implemented yet; iteration 2/3 runtime always calls `fetch_initial`
- ✅ Update `feed_sources.last_attempt_at` before fetch, `last_success_at` after success, `last_error` on failure
- ❌ NEVER hardcode DB credentials — use environment variables
- ❌ NEVER commit `.env` files
