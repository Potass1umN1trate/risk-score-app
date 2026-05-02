# Feed Collector

**Stack**: Python 3.12, asyncpg
**Role**: Automated population of flagged_addresses from external sources
**Runtime**: Kubernetes CronJob (namespace risk-score-app)

---

## Implemented ✅
- DB schema for feed source configuration and evidence storage is present (`feed_sources`, `flagged_address_sources`).
- Six known feed sources are seeded in `feed_sources` (chainabuse, ofac, trm_sanctions, scamsniffer, bitcoinabuse, cryptoscamdb).

## NOT Implemented ❌
- [ ] Full component (CronJob not yet implemented)
- [ ] No feed-collector Python runtime exists yet

---

## Algorithm
```
1.  Query feed_sources WHERE is_active = TRUE, ordered by last_attempt_at ASC NULLS FIRST
2.  For each source:
    a. Set feed_sources.last_attempt_at = NOW()
    b. Check source availability
       UNAVAILABLE → set feed_sources.last_error, log, skip to next source
    c. Is this the first connection to this source?
       YES (last_success_at IS NULL) → fetch last N records (large initial load)
       NO  → fetch only new records since last_success_at
    d. For each fetched address record:
       - Resolve network_id from networks WHERE code = <source_chain>
         UNKNOWN NETWORK → log and skip the record
       - Normalize address format for the network
       - Upsert flagged_addresses:
           ON CONFLICT (network_id, address) DO NOTHING
           (deduplication — never overwrite an existing canonical record)
         On insert: set created_by_user_id = NULL (system record)
       - Resolve the flagged_address_id (by network_id + address)
       - Insert flagged_address_sources evidence row:
           ON CONFLICT (uq_fas_source_external_address or uq_fas_source_address_category)
           DO UPDATE SET last_seen = ..., raw_payload_json = ..., updated_at = NOW()
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
- `flagged_address_sources` — inserts or updates source-specific evidence per report
- `feed_sources` — updates `last_attempt_at`, `last_success_at`, `last_error` after each run
- `audit_logs` — one `FEED_COLLECT` event per source run

### Sync state fields (feed_sources):
- `last_attempt_at` — set at the start of each source run (before any fetch)
- `last_success_at` — set at end of run only when the fetch completed without error; used as the incremental-fetch cursor
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
- ✅ First run per source (`last_success_at IS NULL`) → bulk load; subsequent runs → incremental only (since `last_success_at`)
- ✅ Update `feed_sources.last_attempt_at` before fetch, `last_success_at` after success, `last_error` on failure
- ❌ NEVER hardcode DB credentials — use environment variables
- ❌ NEVER commit `.env` files
