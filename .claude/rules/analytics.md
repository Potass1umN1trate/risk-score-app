# Analytics Service

**Stack**: Python 3.12, FastAPI, XGBoost, asyncpg
**Role**: Blockchain data fetching, graph building, risk scoring

---

## Implemented ✅
- `POST /api/analyze` — main analysis endpoint (analytics/app/api/analyze.py)
- `GET /api/networks` — list supported networks
- `GET /api/model/status` — model load status (k8s readiness probe)
- `GET /health` — healthcheck
- `UniversalXGBoostScorer` — hybrid signal (flag heuristic + XGBoost), `MODEL_VERSION = "universal_xgboost_v1"`, one model for all 10 networks
- Scaler: log1p + z-score, loads from `models/btc_scaler.json`, fallback to hardcoded stats if missing
- Fallback: heuristic-only scoring if model file missing (no crash)
- Address format validation: `app/validators/address.py` — per-network regex
- Fetchers: BTC (mempool.space), ETH (Etherscan v2), TRX, SOL (Helius), BNB (Moralis), XRP, LTC, DOGE, ADA (Blockfrost), TON (TonCenter)
- DB connection pool: asyncpg (main.py lifespan)
- Request lifecycle: `processing → completed / failed`
- History: `get_history_by_user(pool, user_id)` — user-bound, newest first
- Config: `analytics/app/config.py` — database_url, max_depth=5, max_addresses=20, API keys
---

## Analysis Algorithm
```
1.  Receive request (address, network, depth, tx_limit, period_days)
2.  Save analysis_request to DB with status=processing
4.  Fetch tx data from blockchain API
5.  Build transaction graph (BFS up to depth)
6.  Match all graph nodes against flagged_addresses DB
7.  Is root address in flagged DB?
    YES → get flag_type + risk_level from DB → go to step 9 (skip ML)
    NO  → extract 27 numerical features from graph
        → build feature vector (OUR_FEATURE_NAMES order)
        → apply log1p + z-score normalization
        → run XGBoost model (output: probability 0–1 → scale to 0–100)
        → classify risk_level by thresholds:
            LOW    = score < 25
            MEDIUM = 25 ≤ score < 60
            HIGH   = score ≥ 60
9.  Build final result (risk_score, risk_level, factors, nodes, edges)
10. Save analysis_result + address_nodes + graph_edges to DB
11. Set status=completed, return result to client
```

---

## ML Feature Vector (27 features, fixed order)
Defined in `analytics/app/graph/features.py` → `OUR_FEATURE_NAMES`

**Volume (7)**
| Feature | Description |
|---|---|
| tx_in_count | Incoming tx count |
| tx_out_count | Outgoing tx count |
| total_received | Total incoming volume (native currency) |
| total_sent | Total outgoing volume |
| median_tx_amount | Median tx amount |
| max_tx_amount | Max single tx amount |
| unique_counterparties | Unique counterparty addresses |

**Topology (6)**
| Feature | Description |
|---|---|
| depth1_neighbors | Node count at depth 1 |
| depth2_neighbors | Node count at depth 2 |
| in_degree | In-degree of root node |
| out_degree | Out-degree of root node |
| graph_density | edges / max possible edges |
| clustering_coefficient | Clustering coefficient (undirected projection) |

**Temporal (3)**
| Feature | Description |
|---|---|
| active_days | Unique calendar days with transactions |
| tx_per_day | Average tx frequency |
| lifespan_days | Days between first and last tx |

**Risk signals (11)**
| Feature | Description |
|---|---|
| flagged_neighbors_count | Flagged address count in graph |
| flagged_neighbors_ratio | Fraction of flagged among all nodes |
| min_dist_to_flagged | Shortest path to nearest flagged node (999 = none) |
| flag_mixer | Mixer-flagged neighbour count |
| flag_scam | Scam-flagged neighbour count |
| flag_sanctions | Sanctions-flagged neighbour count |
| flag_darknet_market | Darknet market-flagged neighbour count |
| flag_ransomware | Ransomware-flagged neighbour count |
| flag_gambling | Gambling-flagged neighbour count |
| flag_phishing | Phishing-flagged neighbour count |
| flag_suspicious | Suspicious-flagged neighbour count |

Model: `analytics/models/btc_xgboost.json`
Scaler: `analytics/models/btc_scaler.json`

---

## API Contract

```python
# AnalyzeRequest
address: str            # min 10, max 128 chars, format validated per network
network: str            # BTC/ETH/TRX/SOL/BNB/XRP/LTC/DOGE/ADA/TON (uppercased)
depth: int              # 1–5, default 2
tx_limit: int           # 1–200, default 50
period_days: int | None # 1–3650, optional

# AnalyzeResponse (HTTP 200 — success only)
request_id, result_id, address, network
risk_score: float       # 0.00–100.00
risk_level: str         # LOW / MEDIUM / HIGH
model_version: str      # "universal_xgboost_v1" | "universal_xgboost_v1_heuristic" | "database_lookup"
scoring_method: str     # "ml_model" | "database"
flag_type: str | None   # set when scoring_method == "database"
nodes_count, edges_count
nodes: list[NodeOut]
edges: list[EdgeOut]    # one entry per directed address pair (aggregated)
# EdgeOut: from_address, to_address, tx_count, total_amount
features: dict          # set when scoring_method == "ml_model"
analyzed_at: str        # ISO datetime
```

### Structured Error Response (all non-200 cases)

All error responses return JSON with this shape regardless of HTTP status:

```json
{
  "error_code": "<machine-readable string>",
  "detail": "<human-readable message>",
  "request_id": "<UUID string or null>"
}
```

| `error_code` | HTTP status | Cause |
|---|---|---|
| `INVALID_ADDRESS` | 400 | Address fails per-network format validation |
| `UNSUPPORTED_NETWORK` | 400 | Network code not in supported set |
| `BLOCKCHAIN_RATE_LIMITED` | 429 | All upstream providers returned HTTP 429 |
| `BLOCKCHAIN_UNAVAILABLE` | 502 | All upstream providers failed (timeout, 5xx, network error) |
| `INTERNAL_ERROR` | 500 | Unexpected internal failure (DB error, scoring bug, etc.) |

- `request_id` is `null` for errors detected before the DB record is created (INVALID_ADDRESS, UNSUPPORTED_NETWORK).
- `request_id` is present for errors detected after the DB record is created (BLOCKCHAIN_*, INTERNAL_ERROR) — the failed request is always persisted.
- Raw internal exception text is NEVER included in `detail`. The internal reason is logged server-side and persisted in `analysis_requests.error_message`.

---

## Constraints
- ❌ NEVER exceed max_depth=5 or max_addresses_per_analysis=20
- ❌ NEVER change AnalyzeRequest/AnalyzeResponse schema without updating this file
- ❌ NEVER retrain model inline — training is in `analytics/training/` only
- ✅ risk_level: exactly `LOW`, `MEDIUM`, `HIGH` — no other values
- ✅ Always save analysis_request to DB BEFORE calling blockchain API
- ✅ Early exit if root address in flagged_addresses — skip ML entirely
- ✅ Blockchain fetchers MUST raise `BlockchainRateLimitedError` on HTTP 429 and `BlockchainUnavailableError` when all providers fail — returning `[]` on total failure is FORBIDDEN (it is indistinguishable from a legitimate empty address)
- ✅ Partial success within a fetch (e.g. one TX in a batch fails) may still return `[]` for that TX only; a full provider outage must raise
- ✅ Fallback to heuristic if model file missing — do not crash
- ✅ All async DB operations via app.state.db_pool (asyncpg)
- ❌ NEVER hardcode DB credentials — use config.py / environment variables
- ❌ NEVER commit model files analytics/models/*.json (in .gitignore)
- ❌ NEVER expose raw exception text or SQL errors in API error responses — use structured ErrorResponse only
