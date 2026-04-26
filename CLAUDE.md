# Risk Score — Crypto Address Analysis

## Stack
- **web-app**: Next.js 15, TypeScript, NextAuth.js (Node.js 22 LTS)
- **analytics-service**: Python 3.12, FastAPI, XGBoost
- **feed-collector**: Python 3.12, CronJob
- **db**: PostgreSQL 16.4 (asyncpg)
- **infra**: Kubernetes K3s, namespace `risk-score-app`

## Architecture
```
Browser → HTTPS → ingress-nginx → HTTP → web-app (Next.js)
                                          ↓ HTTP REST
                                   analytics-service (FastAPI)
                                          ↓ TCP/SQL
                                       PostgreSQL
feed-collector (CronJob) ──────────────────↑
```

## Roles
`user` → `moderator` → `admin` (три роли, других нет)

## Global Constraints
- risk_score: `DECIMAL(6,2)`, scale 0–100
- risk_level: exactly `LOW` / `MEDIUM` / `HIGH`
- Address uniqueness: always `(network_id, address)` pair, never address alone
- All UUIDs: CHAR(36) generated server-side
- NEVER hardcode DB credentials
- NEVER commit .env or model files

## Component Specs (functions + constraints per component)
- @.claude/rules/web-app.md
- @.claude/rules/analytics.md
- @.claude/rules/feed-collector.md
- @.claude/rules/db-schema.md
