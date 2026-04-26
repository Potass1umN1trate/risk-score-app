# Feed Collector

**Stack**: Python 3.12, asyncpg
**Role**: Automated population of flagged_addresses from external sources
**Runtime**: Kubernetes CronJob (namespace risk-score-app)

---

## Implemented ✅
- [ ] fill after reviewing feed-collector directory

## NOT Implemented ❌
- [ ] Full component (CronJob not yet implemented)

---

## Algorithm
```
1.  Get list of configured external sources
2.  For each source:
    a. Check source availability
       UNAVAILABLE → log, skip to next source
    b. Is this the first connection to this source?
       YES → fetch last N records (large initial load)
       NO  → fetch only new records since last_fetched_at
    c. For each fetched address:
       - Normalize address format
       - Check duplicate: (network_id, address) already in flagged_addresses?
         YES → skip (deduplication)
         NO  → insert with is_active=TRUE, created_by_user_id=NULL (system record)
    d. Update last_fetched_at for source
3.  Log run results to audit_logs (action: FEED_COLLECT)
```

---

## Data Contract with DB
- Writes only to: `flagged_addresses`
- Reads from: `networks` (to resolve network_id by code), `flagged_addresses` (deduplication)
- System-created records: `created_by_user_id = NULL`
- Deduplication key: `(network_id, address)` — never insert duplicates
- Deactivation: never deactivates existing records, only inserts new ones

---

## Constraints
- ❌ NEVER delete or deactivate existing flagged_addresses records
- ❌ NEVER insert duplicate (network_id, address) pairs
- ✅ created_by_user_id = NULL for all system-inserted records
- ✅ Unavailable source → skip and continue, do not crash the job
- ✅ Log each run to audit_logs
- ✅ First connection to source → bulk load; subsequent → incremental only
- ❌ NEVER hardcode DB credentials — use environment variables
- ❌ NEVER commit .env files
