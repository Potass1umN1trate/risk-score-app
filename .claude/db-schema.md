# Database Schema (PostgreSQL 16.4)

> Source: ТЗ section 3.2 + инфологическая модель (рисунок 2.2)
> ORM: Prisma (web-app) | asyncpg raw SQL (analytics-service)
> Connection: `postgresql://riskapp:riskapp_secret@postgres:5432/riskscoredb`
> K8s service: `postgres:5432` (ClusterIP, namespace risk-score-app)

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

### risk_categories
| Column | Type | Notes |
|---|---|---|
| id | SERIAL | PK |
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

### analysis_requests
| Column | Type | Notes |
|---|---|---|
| id | CHAR(36) | PK (UUID) |
| user_id | CHAR(36) | nullable FK → users.id (NULL = internal/anonymous call) |
| network_id | INT | nullable FK → networks.id |
| network_code | VARCHAR(10) | network code (e.g. `BTC`, `ETH`) — fast lookup without JOIN |
| address | VARCHAR(128) | NOT NULL |
| depth | INT | NOT NULL — analysis parameter, default 2 |
| limit_tx | INT | NOT NULL — analysis parameter, default 50 |
| period_days | INT | nullable — optional analysis period in days |
| status | VARCHAR(20) | NOT NULL — request lifecycle: `pending` / `processing` / `completed` / `failed` |
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
| factors_json | JSONB | nullable — `{scoring_method, model_version, raw_probability, features: {...}}` |
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
| action | VARCHAR(64) | LOGIN, RUN_ANALYSIS, ADD_FLAGGED, etc. |
| entity | VARCHAR(64) | nullable |
| entity_id | CHAR(36) | nullable |
| details_json | JSONB | nullable |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
