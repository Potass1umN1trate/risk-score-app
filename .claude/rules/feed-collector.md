# Feed Collector

**Stack**: Python 3.12, asyncpg
**Role**: Automated population of flagged_addresses from external sources
**Target Runtime**: Kubernetes CronJob (manifest not implemented yet; namespace risk-score-app)

---

## Implemented ✅
- DB schema for feed source configuration and evidence storage is present (`feed_sources`, `flagged_address_sources`).
- Six known feed sources are seeded in `feed_sources` (chainabuse, ofac, trm_sanctions, scamsniffer, bitcoinabuse, cryptoscamdb).
- Standalone Python skeleton (`feed_collector/`) with dry-run pipeline — no DB writes in dry-run mode; default source remains local dummy and makes no external API calls:
  - `feed_collector/app/config.py` — `FeedCollectorSettings` via pydantic-settings; loads local developer settings from `feed_collector/.env` using a path resolved relative to `config.py`, so `python3 feed_collector/main.py --dry-run` works from repo root and `python3 main.py --dry-run` works from `feed_collector/`; process environment variables still override `.env`; `database_url` optional when `dry_run=True`; required (model_validator raises) when `dry_run=False`; `dry_run=True` default; `dummy_initial_limit`, `enabled_sources`, `log_level`; Chainabuse settings (`chainabuse_api_key`, `chainabuse_base_url`, `chainabuse_timeout_seconds`, `chainabuse_per_page`, `chainabuse_initial_max_pages`, optional `before`/`checked`/`trusted`/`category`/`chain` filters); ScamSniffer settings (`scamsniffer_address_blacklist_url`, `scamsniffer_timeout_seconds`, `scamsniffer_evm_networks`, default `ETH,BNB`); OFAC SLS settings (`ofac_base_url`, `ofac_sdn_filename`, `ofac_timeout_seconds`, `ofac_use_alive_check`). `chainabuse_per_page` is validated to 1–50 and `chainabuse_initial_max_pages` to >= 1. `CHAINABUSE_API_KEY` is not required unless ChainabuseSource is selected/used. ScamSniffer and OFAC require no API key.
  - `feed_collector/.env.example` — placeholder-only local configuration template. Real `feed_collector/.env` files are developer-local secrets and must never be committed.
  - `feed_collector/README.md` — local dummy dry-run instructions plus Chainabuse, ScamSniffer, and OFAC source notes. Chainabuse has a manual `/v0/reports` dry-run smoke procedure using either `feed_collector/.env` or shell-only environment variables. OFAC has a manual SLS XML dry-run procedure and warns that the public XML may be large.
  - `feed_collector/app/models.py` — `FeedSourceConfig`, source-native `RawFeedRecord`, internal `NormalizedFlaggedAddress` with preserved evidence metadata (`source_chain`, `source_category`, `trusted`, `checked`, `first_seen`, `last_seen`, `raw_payload`), `FeedRunResult` dataclasses. `FeedRunResult` records `fetch_mode` (`initial`, `incremental`, or `repeat_full`) and the `fetch_since` timestamp used for incremental runs.
  - `feed_collector/app/source_base.py` — abstract `FeedSource` interface: `source_code`, `check_availability()`, `supports_time_filter`, `fetch_initial(limit)`, `fetch_since(since, limit)`.
  - `feed_collector/app/mappings.py` — explicit source-aware mappings from feed-native chain/category values to project codes. Implemented for `dummy`, `chainabuse`, `scamsniffer`, and `ofac`; OFAC source categories always map to internal `sanctions`, while OFAC program tags remain evidence metadata.
  - `feed_collector/app/normalizer.py` — supported project network set (BTC/ETH/TRX/SOL/BNB/XRP/LTC/DOGE/ADA/TON); `normalize_feed_record(source_code, record)` maps source-native chain/category values, strips addresses, lowercases ETH/BNB, preserves evidence metadata, and deterministically skips missing-address/unsupported-chain/unsupported-network/unsupported-category records. Regex validation remains deferred.
  - `feed_collector/app/sources/dummy.py` — `DummySource`: `source_code="dummy"`, always available, `supports_time_filter=False`, `fetch_initial` returns 3 source-native hardcoded records (BTC scam, ETH phishing, FAKECHAIN scam to exercise skip path), `fetch_since` returns `[]`; no network calls.
  - `feed_collector/app/sources/chainabuse.py` — `ChainabuseSource`: first real source adapter; `source_code="chainabuse"`, `supports_time_filter=True`, uses `httpx.AsyncClient` against Chainabuse `GET /reports` only, with HTTP Basic Auth where API key is the username and password is blank. The deprecated `GET /sanctioned-addresses/{address}` endpoint is forbidden and must not be used. `check_availability()` never raises, returns `False` when the API key is missing, and otherwise checks `GET /reports?page=1&perPage=1`, returning `True` only for HTTP 200 with valid JSON object containing a `reports` list. `fetch_initial(limit)` paginates with `page`/`perPage`, never sends `since`, respects `limit`, `chainabuse_initial_max_pages`, and `perPage <= 50`. `fetch_since(since, limit)` is implemented for the source and sends `since` as UTC ISO-8601; non-dry-run repeat runs select it when `feed_sources.last_success_at` is set. Optional request filters: `before`, `checked`, `trusted`, `category`, `chain`. Response conversion fans out each report's `addresses[]` into one `RawFeedRecord` per non-blank address entry: report `id` → `external_id`, `trusted`/`checked` preserved, `scamCategory` → `source_category`, `createdAt` → `first_seen` and `last_seen`, address entry `chain` → `source_chain`, and compact report/address evidence into `raw_payload`. Domain-only records and missing/blank addresses are ignored; domains are never placed in `RawFeedRecord.address`. Missing/blank chain still produces a record with `source_chain=None` so the normalizer can skip it deterministically. Non-2xx, timeout/connect errors, invalid JSON, and malformed top-level responses raise sanitized `ChainabuseSourceError` without API keys or auth headers.
  - `feed_collector/app/sources/scamsniffer.py` — `ScamSnifferSource`: GitHub raw static source adapter for `https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json`; `source_code="scamsniffer"`, `supports_time_filter=False`, no API key. The address blacklist has no reliable per-address chain metadata and domains are not imported. The adapter parses supported JSON shapes (`list[str]`, object with `addresses: list[str]`, object whose keys are addresses), accepts only `0x` + 40 hex EVM-style addresses, and intentionally expands each EVM-unspecified address to supported configured project EVM networks `ETH` and `BNB` only. It emits synthetic `source_chain` labels `EVM_UNSPECIFIED_EXPANDED_ETH` and `EVM_UNSPECIFIED_EXPANDED_BNB`, `source_category="PHISHING"`, and evidence payload fields `chain_scope="EVM_UNSPECIFIED_EXPANDED"` and `expanded_to_network`. This is a project heuristic for wallet-owner risk, not source proof of malicious activity on each chain. `fetch_since()` returns `[]`; non-2xx, timeout/connect errors, invalid JSON, and unsupported top-level shapes raise sanitized `ScamSnifferSourceError`.
  - `feed_collector/app/sources/ofac.py` — `OfacSource`: official OFAC Sanctions List Service adapter for digital currency address extraction only; `source_code="ofac"`, `supports_time_filter=False`, no API key. It uses `GET {ofac_base_url}/alive` for health when `ofac_use_alive_check=True`, otherwise `HEAD {ofac_base_url}/api/download/{ofac_sdn_filename}`; `check_availability()` never raises. `fetch_initial(limit)` downloads `GET /api/download/SDN_ADVANCED.XML` by default and parses XML with stdlib `xml.etree.ElementTree`, using namespace-insensitive/tolerant element matching. It detects identifier/feature type text like `Digital Currency Address - ETH`, extracts the asset and address value, preserves OFAC entity/list/program evidence in `raw_payload`, sets `source_category` to comma-separated OFAC program tags or `SANCTIONS`, and emits `trusted=True`, `checked=True`. Program tags such as `CYBER2`, `DPRK3`, or `RUSSIA-EO14024` are never converted into internal risk categories; OFAC records map to internal `sanctions` through `mappings.py`. USDT/USDC are not mapped by symbol alone: `T` + 33 base58-like chars infer TRX with `OFAC_TOKEN_<ASSET>_TRX_INFERRED`, `0x` + 40 hex infers ETH with `OFAC_TOKEN_<ASSET>_ETH_INFERRED`, and other token address formats are skipped. `raw_payload.token_network_inferred` records this heuristic. `fetch_since()` returns `[]`; `/changes/latest` and `/changes/history` incremental diffing are not implemented yet. The adapter does not parse HTML and does not perform OFAC name/person/entity screening.
  - `feed_collector/app/pipeline.py` — `run_pipeline(source, settings, db_pool=None) -> FeedRunResult`; `dry_run=True` path: checks availability, fetches initial records, normalizes source-native records through `normalize_feed_record`, returns summary with `fetch_mode="initial"`, never connects to DB; `dry_run=False` path: requires `db_pool`, looks up `feed_sources` by `source_code`, marks attempt, chooses fetch mode from `feed_sources.last_success_at` and `source.supports_time_filter`, normalizes, resolves mapped network/category ids, upserts `flagged_addresses` and inserts `flagged_address_sources`, marks success or failure, writes `FEED_COLLECT` audit log; if source code is not present/active in `feed_sources`, returns an error result without fetching. DB fetch modes are `initial` when `last_success_at IS NULL`, `incremental` when `last_success_at` is set and the source supports time filtering, and `repeat_full` when `last_success_at` is set but the source does not support time filtering. Failed incremental fetches do not fallback to initial fetch.
  - `feed_collector/app/repository.py` — asyncpg-based repository: `get_feed_source_by_code`, `mark_feed_attempt`, `mark_feed_success`, `mark_feed_failure`, `resolve_network_id`, `resolve_risk_category_id`, `upsert_flagged_address` (INSERT … ON CONFLICT DO NOTHING + SELECT fallback), `insert_flagged_address_source` (ON CONFLICT DO NOTHING, branches on `external_id`, stores preserved evidence fields), `write_audit_log` (includes fetch mode and incremental cursor timestamp in `details_json`).
  - `feed_collector/main.py` — CLI entry point; `--dry-run` (default) / `--no-dry-run`; source selection accepts comma-separated `enabled_sources` but current runtime uses only the first value and defaults to `dummy`; selecting `chainabuse` instantiates `ChainabuseSource`; selecting `scamsniffer` instantiates `ScamSnifferSource`; selecting `ofac` instantiates `OfacSource`; `--no-dry-run` creates asyncpg pool from `settings.database_url`, passes it to `run_pipeline`, closes pool reliably; never prints credentials.
  - Unit tests in `feed_collector/tests/` cover models, source mappings, normalizer behavior, DummySource, ChainabuseSource with mocked httpx only, ScamSnifferSource with mocked httpx only, OfacSource with mocked httpx/XML fixtures only, config env-file path behavior, and full dry-run pipeline; no test depends on live Chainabuse, live GitHub, live OFAC, or live API keys.
  - 19 Postgres integration tests in `feed_collector/tests/test_repository_postgres_integration.py` (skipped without `TEST_DATABASE_URL`): repository function coverage, full `dry_run=False` end-to-end with DummySource, missing-source error path.
  - **`dry_run=True` does not connect to DB.** Dry-run has no DB sync state and always uses `fetch_initial`. For Chainabuse, dry-run can make real `GET /v0/reports` calls during a manual smoke run, but it does not write to DB. `dry_run=False` requires `DATABASE_URL` (enforced by config validator), reads `feed_sources.last_success_at` for fetch selection, and writes to `flagged_addresses`, `flagged_address_sources`, `feed_sources` sync columns, and `audit_logs`.
  - **`feed_sources` must contain an active row for `source_code` before DB writes occur.** If the row is missing or inactive, the pipeline returns an error result immediately without fetching records.
  - Verified (2026-05-02): dry-run runs cleanly from repo root and from `feed_collector/` (`fetched=3 normalized=2 skipped=1 dry_run=True`); config raises `ValidationError` when `dry_run=False` and `database_url=None`; 115 feed collector tests pass; 19 integration tests are present and skipped unless `TEST_DATABASE_URL` is set.

## NOT Implemented ❌
- [ ] Kubernetes CronJob manifest for feed-collector (`k8s/feed-collector/` is empty)
- [ ] Kubernetes Secret manifest for Chainabuse/API credentials
- [ ] Full multi-source orchestration in runtime (`ENABLED_SOURCES` may be comma-separated, but only the first source is executed)
- [ ] Real source integrations other than Chainabuse, ScamSniffer address blacklist, and OFAC SDN digital currency addresses: TRM Sanctions, BitcoinAbuse, CryptoScamDB
- [ ] OFAC name/person/entity screening beyond digital currency address extraction
- [ ] OFAC `/changes/latest` or `/changes/history` incremental diff support
- [ ] ScamSniffer domain blacklist import
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
    c. Choose fetch mode:
       - `feed_sources.last_success_at IS NULL` → `fetch_initial(limit)`, `fetch_mode="initial"`
       - `last_success_at IS NOT NULL` and `source.supports_time_filter=True` → `fetch_since(last_success_at, limit)`, `fetch_mode="incremental"`
       - `last_success_at IS NOT NULL` and `source.supports_time_filter=False` → `fetch_initial(limit)`, `fetch_mode="repeat_full"`
       Failed `fetch_since` calls do not fallback to `fetch_initial`; the source run fails so time-filter/API bugs remain visible.
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
- `chainabuse` source adapter is implemented for `GET /reports` only; the deprecated sanctions endpoint must not be used.
- Chainabuse chains: `BTC → BTC`, `ETH → ETH`, `TRON → TRX`, `SOL → SOL`, `BINANCE → BNB`, `LITECOIN → LTC`, `CARDANO → ADA`, `TON → TON`; known but unseeded project networks such as `POLYGON`, `HBAR`, `AVALANCHE`, `MULTIVERSX`, `ARBITRUM`, `ALGORAND`, `BASE` map to skip for now; `XRP` and `DOGE` map to skip for Chainabuse per the provided contract.
- Chainabuse categories: `PHISHING → phishing`, `RANSOMWARE → ransomware`; investment/social scam group maps to `scam`; exploit/other/null/unknown group maps to `suspicious`.
- ScamSniffer source adapter imports the raw address blacklist only, not domains. ScamSniffer synthetic chains: `EVM_UNSPECIFIED_EXPANDED_ETH → ETH`, `EVM_UNSPECIFIED_EXPANDED_BNB → BNB`; no other EVM networks are supported for this task. ScamSniffer categories: `PHISHING`, `phishing`, null, and unknown values all map to `phishing` because this source is specifically a phishing blacklist.
- OFAC source adapter imports SDN Advanced XML through `GET https://sanctionslistservice.ofac.treas.gov/api/download/SDN_ADVANCED.XML` by default and checks `/alive` by default; no API key is required. OFAC chains: `XBT → BTC`, `BTC → BTC`, `ETH → ETH`, `TRX → TRX`, `LTC → LTC`, `XRP → XRP`, `ADA → ADA`, `DOGE → DOGE`, `TON → TON`, `BNB → BNB`, `BSC → BNB`, `OFAC_TOKEN_USDT_ETH_INFERRED → ETH`, `OFAC_TOKEN_USDC_ETH_INFERRED → ETH`, `OFAC_TOKEN_USDT_TRX_INFERRED → TRX`, `OFAC_TOKEN_USDC_TRX_INFERRED → TRX`. OFAC categories: any source category, including null/unknown comma-separated program tags, maps to internal `sanctions`. Program tags remain source evidence and raw payload metadata only.
- All mappings are case-insensitive and trim surrounding whitespace.

### Sync state fields (feed_sources):
- `last_attempt_at` — set at the start of each source run (before any fetch)
- `last_success_at` — set at end of run only when fetch, normalization, and DB persistence complete without error; used as the next incremental cursor for sources with `supports_time_filter=True`
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
- ✅ Initial vs repeat source sync is implemented for non-dry-run mode using `feed_sources.last_success_at` and `source.supports_time_filter`
- ✅ Dry-run always uses `fetch_initial` because it has no DB sync state
- ✅ Failed `fetch_since` calls fail the source run; no automatic fallback to `fetch_initial`
- ✅ Update `feed_sources.last_attempt_at` before fetch, `last_success_at` after success, `last_error` on failure
- ❌ NEVER hardcode DB credentials — use environment variables
- ❌ NEVER commit `.env` files
- ❌ NEVER commit API keys, Authorization headers, or real database URLs
- ✅ `feed_collector/.env.example` may be committed because it contains placeholders only
- ✅ Chainabuse live smoke checks are manual only; automated tests must continue to use mocks and must not call the live Chainabuse API
- ✅ ScamSniffer tests must use mocked GitHub raw responses and must not call live GitHub
- ✅ OFAC tests must use mocked SLS HTTP responses/local XML fixtures and must not call live OFAC
