# Database Schema (PostgreSQL 16.4)

> Source: ТЗ section 3.2 + инфологическая модель (рисунок 2.2)
> ORM: Prisma (web-app) | asyncpg raw SQL (analytics-service)
> Connection: `postgresql://riskapp:riskapp_secret@postgres:5432/riskscoredb`
> K8s service: `postgres:5432` (ClusterIP, namespace risk-score-app)

Migration files for existing PostgreSQL PVCs:
- `k8s/postgres/migrations/20260429_network_analysis_limits.sql` — idempotently adds network analysis limit columns and constraints to `networks`.
- `k8s/postgres/migrations/20260501_audit_logs_actor_role.sql` — idempotently adds `audit_logs.actor_role`, its constraint, and index.
- `k8s/postgres/migrations/20260502_feed_sources.sql` — idempotently adds `feed_sources`, `flagged_address_sources`, their triggers, indexes, and seeds six known feed source rows.

Fresh empty PVCs receive the current schema from `k8s/postgres/initdb-configmap.yaml`; already-initialized PVCs do not rerun initdb and must receive migrations explicitly.

---

## Address Uniqueness Rule
**CRITICAL**: Address uniqueness is always determined by `(network_id, address)` pair.
The same string address can exist in different networks. Never query by address alone.

---

## Tables

### roles
| Column | Type | Notes |
|---|---|---|
| id | SERIAL | PK |
| name | VARCHAR(32) | UNIQUE — values: `user`, `moderator`, `admin` |

### users
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(255) | nullable (OAuth-only users) |
| is_blocked | BOOLEAN | NOT NULL DEFAULT FALSE |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### user_roles
| Column | Type | Notes |
|---|---|---|
| user_id | CHAR(36) | FK → users.id |
| role_id | INT | FK → roles.id |

### oauth_accounts
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| user_id | CHAR(36) | FK → users.id |
| provider | VARCHAR(50) | e.g. `github` |
| provider_account_id | VARCHAR(255) | UNIQUE per (provider, provider_account_id) |
| created_at | TIMESTAMPTZ | |

### networks
| Column | Type | Notes |
|---|---|---|
| id | SERIAL | PK |
| code | VARCHAR(16) | UNIQUE — e.g. `BTC`, `ETH`, `TRX` |
| name | VARCHAR(64) | |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE |
| default_depth | INTEGER | NOT NULL DEFAULT 2; must be >= 1 |
| max_depth | INTEGER | NOT NULL DEFAULT 5; must be >= default_depth |
| default_tx_limit | INTEGER | NOT NULL DEFAULT 10; must be >= 1 |
| max_tx_limit | INTEGER | NOT NULL DEFAULT 200; must be >= default_tx_limit |
| default_period_days | INTEGER | nullable; NULL = no period filter by default; when set must be >= 1 and <= max_period_days |
| max_period_days | INTEGER | NOT NULL DEFAULT 3650; must be >= 1 |

### risk_categories
| Column | Type | Notes |
|---|---|---|
| id | SERIAL | PK |
| code | VARCHAR(32) | UNIQUE, NOT NULL — machine-readable category code used as flag_type |
| name | VARCHAR(100) | UNIQUE, NOT NULL |
| severity | INT | NOT NULL — weight used in scoring (0–100) |

### flagged_addresses
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| network_id | INT | FK → networks.id |
| address | VARCHAR(128) | UNIQUE with network_id |
| risk_category_id | INT | FK → risk_categories.id |
| comment | TEXT | nullable |
| created_by_user_id | CHAR(36) | FK → users.id |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE — soft delete; moderator sees only own records for deactivation |

### feed_sources
Stores configuration and sync state for each external threat-intel feed integration.
One row per feed (Chainabuse, OFAC, TRM, ScamSniffer, BitcoinAbuse, CryptoScamDB, …).

| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) — deterministic seed UUIDs for known sources |
| code | VARCHAR(64) | UNIQUE — machine-readable feed key, e.g. `chainabuse`, `ofac` |
| name | VARCHAR(128) | Human-readable display name |
| base_url | TEXT | nullable — API base URL when documented |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE — disabled rows are skipped by feed-collector |
| last_success_at | TIMESTAMPTZ | nullable — set by feed-collector after a successful run |
| last_attempt_at | TIMESTAMPTZ | nullable — set by feed-collector at the start of each run |
| last_error | TEXT | nullable — last error message if the run failed |
| config_json | JSONB | nullable — source-specific config (API key ref name, pagination params, etc.) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() — managed by `trg_feed_sources_updated_at` trigger |

Seeded rows (idempotent `ON CONFLICT (code) DO NOTHING`):

| code | name | base_url |
|---|---|---|
| `chainabuse` | Chainabuse | `https://api.chainabuse.com/v0` |
| `ofac` | OFAC SDN | NULL |
| `trm_sanctions` | TRM Sanctions | NULL |
| `scamsniffer` | ScamSniffer | NULL |
| `bitcoinabuse` | BitcoinAbuse | NULL |
| `cryptoscamdb` | CryptoScamDB | NULL |

### flagged_address_sources
Source-specific evidence for a flagged address. One row per `(feed_source, external_report, flagged_address)` when `external_id` is set, or per `(feed_source, flagged_address, source_category)` when it is not.

| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| flagged_address_id | CHAR(36) | NOT NULL FK → flagged_addresses.id ON DELETE CASCADE |
| feed_source_id | CHAR(36) | NOT NULL FK → feed_sources.id ON DELETE CASCADE |
| external_id | VARCHAR(255) | nullable — source-specific report ID or URL |
| source_category | VARCHAR(128) | nullable — risk category as reported by the source (may differ from risk_categories.code) |
| source_chain | VARCHAR(64) | nullable — blockchain/network as reported by the source |
| confidence | DECIMAL(5,2) | nullable — source confidence score |
| trusted | BOOLEAN | nullable — source-level trusted flag |
| checked | BOOLEAN | nullable — source-level checked/verified flag |
| first_seen | TIMESTAMPTZ | nullable — earliest report timestamp from the source |
| last_seen | TIMESTAMPTZ | nullable — most recent report timestamp from the source |
| raw_payload_json | JSONB | nullable — snapshot of raw source payload for auditability |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() — managed by `trg_flagged_address_sources_updated_at` trigger |

Indexes:
- `idx_fas_flagged_address` on `(flagged_address_id)` — fetch all sources for one address
- `idx_fas_feed_source` on `(feed_source_id)` — fetch all records from one source
- `idx_fas_feed_source_external_id` on `(feed_source_id, external_id) WHERE external_id IS NOT NULL`

Uniqueness:
- `uq_fas_source_external_address` UNIQUE on `(feed_source_id, external_id, flagged_address_id) WHERE external_id IS NOT NULL`
- `uq_fas_source_address_category` UNIQUE on `(feed_source_id, flagged_address_id, source_category) NULLS NOT DISTINCT WHERE external_id IS NULL` — `NULLS NOT DISTINCT` ensures rows with `NULL source_category` are also deduplicated

### analysis_requests
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| user_id | CHAR(36) | nullable FK → users.id (NULL = internal/anonymous call) |
| network_code | VARCHAR(10) | network code (e.g. `BTC`, `ETH`) — fast lookup without JOIN |
| address | VARCHAR(128) | NOT NULL |
| depth | INT | NOT NULL — analysis parameter, default 2 |
| limit_tx | INT | NOT NULL — analysis parameter, default 50 |
| period_days | INT | nullable — optional analysis period in days |
| status | VARCHAR(20) | NOT NULL — request lifecycle: `processing` / `completed` / `failed` |
| error_message | TEXT | nullable — failure reason, set by `mark_request_failed` |
| result_id | CHAR(36) | nullable — reference to analysis_results.id, set by `mark_request_completed` |
| created_at | TIMESTAMPTZ | NOT NULL |
| completed_at | TIMESTAMPTZ | nullable — set on completion or failure |

### analysis_results
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| request_id | CHAR(36) | NOT NULL UNIQUE FK → analysis_requests.id (CASCADE DELETE) |
| address | VARCHAR(128) | NOT NULL — analyzed root address snapshot |
| network_code | VARCHAR(10) | NOT NULL — analyzed network code snapshot (e.g. `BTC`, `ETH`) |
| risk_score | DECIMAL(6,2) | NOT NULL — 0.00–100.00 |
| risk_level | VARCHAR(32) | NOT NULL — `LOW` / `MEDIUM` / `HIGH` |
| model_version | VARCHAR(64) | nullable — model/scoring implementation version |
| raw_probability | FLOAT | nullable — raw model/scoring probability, 0.0–1.0 |
| factors_json | JSONB | nullable — `{scoring_method, model_version, raw_probability, factors: [...], features: {...}}`; `factors` contains structured human-readable factor objects (`key`, `label`, `value`, `severity`, `description`) generated from DB flags and computed features |
| analyzed_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() — analysis timestamp |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### address_nodes
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| result_id | CHAR(36) | NOT NULL FK → analysis_results.id (CASCADE DELETE) |
| network_id | INT | NOT NULL FK → networks.id |
| address | VARCHAR(128) | NOT NULL |
| depth | INT | NOT NULL DEFAULT 0 — BFS depth from the analyzed root address |
| is_root | BOOLEAN | NOT NULL DEFAULT FALSE — true for the analyzed root address |
| is_flagged | BOOLEAN | NOT NULL DEFAULT FALSE — true if the node matched flagged_addresses |
| flag_types | TEXT[] | nullable — matched risk category codes for this node (e.g. `["mixer", "scam"]`) |
| tags_json | JSONB | nullable — additional node metadata `{depth, is_root, flags: [...]}` |

### graph_edges
One row = one aggregated directed edge `(from_address, to_address)` within a single analysis result.
Multiple raw blockchain transactions between the same address pair are collapsed into a single row at graph-build time; they are **not** stored as individual rows.

| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| result_id | CHAR(36) | FK → analysis_results.id |
| network_id | INT | FK → networks.id |
| from_address | VARCHAR(128) | |
| to_address | VARCHAR(128) | |
| tx_count | INTEGER | number of raw transactions aggregated into this edge; DEFAULT 1 |
| amount | DECIMAL(30,10) | total volume across all aggregated transactions (native units) |
| first_seen | TIMESTAMPTZ | nullable — timestamp of the earliest transaction |
| last_seen | TIMESTAMPTZ | nullable — timestamp of the most recent transaction |

### audit_logs
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| user_id | CHAR(36) | FK → users.id |
| actor_role | VARCHAR(16) | nullable actor role snapshot at event creation; allowed values: `user`, `moderator`, `admin`; NULL for historical/system/unknown-actor events |
| action | VARCHAR(64) | LOGIN, RUN_ANALYSIS, ADD_FLAGGED, etc. |
| entity | VARCHAR(64) | nullable |
| entity_id | CHAR(36) | nullable |
| details_json | JSONB | nullable |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
