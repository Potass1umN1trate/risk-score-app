# Web Application

**Stack**: Next.js 15, TypeScript, NextAuth.js, Node.js 22 LTS  
**Role**: Browser-facing UI + REST API layer + authentication + RBAC + analysis workflow + reports + flagged-address management + history + audit logging

---

## Implemented ✅
- [x] Next.js 15.5.15 project scaffold — App Router, TypeScript strict mode, Node.js 22 LTS, npm
- [x] `web-app/lib/analytics.ts` — typed analytics-service client; defines `AnalyzeRequest`, `AnalyzeResponse`, `NodeOut`, `EdgeOut`, `RiskFactor`, `AnalyticsErrorResponse`, known `AnalyticsErrorCode` values; `submitAnalysis()` browser helper posts to web-app `/api/analyze` proxy (never directly to analytics-service)
- [x] `web-app/app/api/analyze/route.ts` — authenticated server-side proxy `POST /api/analyze`; reads `ANALYTICS_SERVICE_URL` env var; requires a signed-in user; performs a fresh DB check of current `users.is_blocked` and effective role from `users`/`user_roles`/`roles` before proxying; forwards request to analytics-service only after authorization; passes analytics-service status code through; returns structured `INTERNAL_ERROR` on unreachable service; never exposes raw stack traces
- [x] `web-app/app/analyze/page.tsx` — analysis form (address, network, depth, tx_limit, optional period_days); client-side validation before submit; loading state; result rendering (risk_score, risk_level, scoring_method, model_version, flag_type, factors, nodes table, edges table with first_seen/last_seen, ML features table, analyzed_at)
- [x] Structured error handling by `error_code` — `INVALID_ADDRESS` → address field error; `UNSUPPORTED_NETWORK` → network field error; `BLOCKCHAIN_RATE_LIMITED` / `BLOCKCHAIN_UNAVAILABLE` → warning banner; `INVALID_REQUEST` / `INTERNAL_ERROR` / unknown → error banner; `detail` string is never parsed for UI logic
- [x] `web-app/app/page.tsx` — public landing page with sign-in/dashboard entry
- [x] `web-app/.env.example` — documents `ANALYTICS_SERVICE_URL`, `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, and local/staging admin seed variables
- [x] Global CSS with dark theme, no external UI library
- [x] NextAuth.js credentials baseline — email/password login only, JWT sessions, custom `/login` page, no registration, no password reset, no GitHub OAuth
- [x] DB-backed auth lookup — credentials sign-in reads existing Postgres `users`, `user_roles`, and `roles`; verifies `users.password_hash` with bcryptjs; denies login for missing role, invalid password, missing hash, or `users.is_blocked = TRUE`; if multiple roles exist, effective role is strongest by hierarchy `admin > moderator > user`
- [x] JWT/session claims — session token stores `id`, `email`, `role`, and `isBlocked`; allowed roles are exactly `user`, `moderator`, `admin`
- [x] Middleware RBAC foundation — `web-app/middleware.ts` protects `/dashboard`, `/analyze`, `/admin/:path*`, `/moderator/:path*`, `/api/analyze`, `/api/admin/:path*`, `/api/moderator/:path*`, `/api/history/:path*`, and `/api/flagged-addresses/:path*`; unauthenticated page requests redirect to `/login`; unauthenticated API requests return JSON 401; insufficient-role or blocked-claim page requests redirect to `/unauthorized`; insufficient-role or blocked-claim API requests return JSON 403
- [x] Blocked-user baseline — blocked users are denied at sign-in and denied by middleware when the JWT `isBlocked` claim is true; protected API/server guards re-check the database for sensitive actions such as `/api/analyze`
- [x] JWT limitation documented — middleware uses JWT claims, so role/block claims can be stale until token refresh/re-login; full database-backed sessions and immediate global session revocation are not implemented
- [x] Role-aware pages/menu — `/dashboard` shows role-appropriate actions; `/admin` is admin-only placeholder; `/moderator` is moderator/admin placeholder; `/unauthorized` handles denied page access; global navigation shows links according to the current session role
- [x] Admin seed script — `npm run seed:admin` runs `web-app/scripts/seed-admin.ts`, reads `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`, hashes the password with bcryptjs, ensures `admin` role exists, creates/updates the admin user, unblocks that user, and ensures the admin role assignment without printing the password
- [x] Local auth/RBAC smoke verified (2026-04-27): Postgres and analytics-service were reached via local port-forwards; dev server ran on `0.0.0.0:3200` with ignored `.env.local`; `npm run seed:admin` created/updated a test admin without printing the password; unauthenticated `/analyze` and `/admin` redirected to `/login`; unauthenticated `POST /api/analyze` returned JSON 401; seeded admin login returned HTTP 200; `/dashboard`, `/admin`, and `/moderator` were accessible as admin; authenticated `POST /api/analyze` proxied successfully to analytics-service and returned HTTP 200 with `request_id`, `result_id`, `risk_level=MEDIUM`, `scoring_method=ml_model`, and `model_version=universal_xgboost_v1`; setting the test user `is_blocked=true` caused login to fail with HTTP 401; logging in while unblocked, then setting `is_blocked=true`, caused `POST /api/analyze` with the existing JWT cookie to return JSON 403 `reason=blocked` from the fresh DB check; the test user was restored to `is_blocked=false`
- [x] Transaction graph visualization (`web-app/components/TransactionGraph.tsx`) — interactive directed graph using `@xyflow/react` with dagre left-to-right layout; root address shown in indigo, flagged addresses in red, normal addresses in dark surface; directed edges with arrow markers and `N tx` labels; tooltip (title attr) on each edge shows `tx_count`, `total_amount`, `first_seen`, `last_seen`; zoom/pan/fit-view via built-in Controls; long addresses truncated to 8+6 chars; fallback visualization node created if edge references an address missing from `nodes`; empty state renders safe message when `edges.length === 0`; loaded via `next/dynamic` with `ssr: false`
- [x] Sankey transaction-flow diagram (`web-app/components/SankeyDiagram.tsx`) — root-centered depth-1 custom SVG flow diagram (no d3-sankey); incoming counterparties on the left, analyzed root address as a large centered rectangle, outgoing counterparties on the right; only root-adjacent edges are rendered (incoming: `edge.to_address == rootAddress`; outgoing: `edge.from_address == rootAddress`); deeper non-root edges ignored regardless of analysis depth; addresses compared after `trim().toLowerCase()`, original address preserved for display labels; parallel edges per counterparty collapsed by summing `tx_count` and `total_amount` and taking min/max timestamps; flow stroke width scaled by `sqrt(tx_count)` clamped to [2, 24] — `total_amount` does not affect width; `total_amount` shown only in SVG `<title>` tooltip alongside `tx_count`, `first_seen`, `last_seen`; same counterparty that both sends and receives appears in both left and right columns as separate entries; counterparties sorted descending by `tx_count`, capped at 20 per side; root/flagged/normal visual distinction maintained; responsive width via `ResizeObserver`; distinct empty state `"No root-adjacent transaction edges found — Sankey flow is not available."` when no root-adjacent edges; layout-error fallback `"Transaction flow layout could not be generated."`; legend for root/flagged/normal/incoming flow/outgoing flow; loaded via `next/dynamic` with `ssr: false`

## NOT Implemented ❌
- [ ] Frontend UI: history page and flagged-address pages
- [ ] Report export to file
- [ ] Web-app REST API for history, flagged-address management, user management, audit log, system settings
- [ ] Analysis history: own history for user/moderator, all history for admin
- [ ] Re-open saved analysis result without recomputation
- [ ] GitHub OAuth
- [ ] Registration
- [ ] Password reset
- [ ] Database-backed sessions / immediate global session revocation
- [ ] Full audit logging: failed login, analysis run, flagged-address changes, admin actions
- [ ] Moderator + Admin: view flagged-address list
- [ ] Moderator + Admin: add flagged address manually with risk_category + comment
- [ ] Moderator: deactivate only own flagged-address records
- [ ] Admin: deactivate any flagged-address record
- [ ] Admin: import/export flagged-address database
- [ ] Admin: user management
- [ ] Admin: audit log view
- [ ] Admin: system settings for default analysis parameters
- [ ] Web-app container/k8s deployment and internal connection to analytics-service

---

## High-Level Flow

The web application implements the browser-facing algorithm:

1. User opens the system.
2. User authenticates.
3. If login fails, user returns to authorization.
4. If login succeeds, the system determines the user role.
5. Main menu is displayed according to role.
6. User chooses one of the available actions:
   - run address analysis;
   - view analysis history;
   - manage flagged-address database;
   - log out / finish work.

---

## Functions

### Auth

- Implemented login: email + password through NextAuth.js Credentials provider.
- Not implemented: registration, password reset, GitHub OAuth.
- Email must be unique.
- Blocked users (`is_blocked = TRUE`) are denied at sign-in.
- Middleware denies requests when the JWT `isBlocked` claim is true.
- JWT middleware claims can be stale until token refresh/re-login.
- Protected API/server guards re-check DB state for sensitive actions such as `/api/analyze`.
- Full database-backed sessions / immediate global session revocation is NOT Implemented.
- Failed login attempts are not yet written to `audit_logs`.
- Successful login determines the effective user role: `user`, `moderator`, or `admin`; if multiple roles exist, the strongest role is used (`admin > moderator > user`).
- After successful login, user is redirected to the main menu/dashboard.

### Main Menu / Dashboard

Current implemented dashboard/menu:

- Run address analysis for all authenticated roles.
- Moderator tools placeholder for moderator/admin.
- Admin tools placeholder for admin.
- Logout via global navigation.

Full history, flagged-address management, user management, audit log, and system settings modules are NOT Implemented. The menu must not show actions unavailable to the current role, but backend/API access control must still enforce permissions.

### Analysis

- Page: analysis form.
- Form fields:
  - address;
  - network;
  - depth;
  - tx_limit;
  - optional period_days.
- Validate address format before sending request to analytics-service.
- Submit request to analytics-service REST API.
- Analytics-service returns calculated risk result.
- Web-app displays:
  - risk_score;
  - risk_level;
  - scoring_method;
  - model_version;
  - factors;
  - graph nodes;
  - graph edges;
  - edge time range;
  - feature summary where useful.
- Web-app creates a report view from the returned analysis result.
- Analysis result is saved in history by backend persistence flow.
- Web-app visualizes the transaction graph:
  - root address highlighted;
  - counterparties shown as connected nodes;
  - directed edges show transaction direction;
  - edge labels/tooltips show tx_count, total_amount, first_seen, last_seen.
- Web-app visualizes transaction flow as a Sankey diagram:
  - source/target are addresses;
  - flow weight is based on total_amount or tx_count;
  - root address and flagged addresses are visually distinguishable.
- User can export the report to a file.
- Sankey shows only depth-1 root counterparties.
- Root address is a large centered node.
- Incoming flows are rendered from the left into root.
- Outgoing flows are rendered from root to the right.
- Flow width is based on aggregated tx_count per counterparty, not total_amount.

### Analytics-Service Error Handling

On non-200 response from analytics-service, web-app must branch UI behavior by `error_code`.

| `error_code` | UI behaviour |
|---|---|
| `INVALID_REQUEST` | Inline/form-level message: "Invalid request. Check your inputs and try again." |
| `INVALID_ADDRESS` | Inline form error on the address field |
| `UNSUPPORTED_NETWORK` | Inline form error on the network selector |
| `BLOCKCHAIN_RATE_LIMITED` | Toast/banner: "Data provider is rate-limiting — please wait and retry" |
| `BLOCKCHAIN_UNAVAILABLE` | Toast/banner: "Blockchain data is temporarily unavailable — try again later" |
| `INTERNAL_ERROR` | Toast/banner: "Something went wrong. Please try again." |
| unknown / missing | Treat as `INTERNAL_ERROR` |

- ❌ NEVER parse the human-readable `detail` string to decide UI behavior.
- ✅ Always branch by `error_code`.
- ✅ `detail` may be shown to the user only as human-readable explanation, not as machine-readable logic.

### Reports

- Report is generated from an analysis result.
- Report must include:
  - analyzed address;
  - network;
  - risk_score;
  - risk_level;
  - scoring_method;
  - model_version;
  - human-readable risk factors;
  - graph summary;
  - nodes/edges table or graph visualization;
  - analyzed_at timestamp.
- Report can be opened after a new analysis.
- Report can be opened from history without recomputation.
- Report can be exported to file.

### History

- User and moderator can view only their own analysis history.
- Admin can view all users' analysis history.
- History list includes:
  - address;
  - network;
  - risk_score;
  - risk_level;
  - created_at/analyzed_at;
  - status;
  - owner user where admin view is used.
- User can select a saved analysis.
- Web-app displays the saved report without recomputation.
- Saved report can be exported to file.
- History API and history access control are web-app responsibilities.
- Analytics-service only persists analysis records and does not expose public history endpoints.

### Flagged Addresses

- View list: moderator + admin only.
- Add record manually: moderator + admin only.
- Required fields when adding:
  - network;
  - address;
  - risk_category;
  - comment.
- Upload/import from file: admin only.
- Import flow:
  - upload file;
  - extract address data;
  - validate records;
  - remove duplicates;
  - write valid unique records to database.
- Deactivate:
  - moderator can deactivate only records where `created_by_user_id = current_user.id`;
  - admin can deactivate any record.
- Deactivation is soft delete / inactive status, not physical deletion.
- Export flagged-address database to file: admin only.
- User must not see the full flagged-address database.

### User Management

Admin only:

- List users.
- View user details.
- Change role.
- Block/unblock user.
- Ensure roles remain only:
  - `user`;
  - `moderator`;
  - `admin`.

### Audit Log

Admin only:

- View audit journal.
- Events include:
  - failed login;
  - successful login where needed;
  - run analysis;
  - add flagged address;
  - deactivate flagged address;
  - import flagged addresses;
  - export flagged addresses;
  - user role change;
  - block/unblock user.
- Raw SQL errors or internal stack traces must never be exposed through API responses.

### System Settings

Admin only:

- Configure default analysis parameters:
  - default depth;
  - default tx_limit;
  - optional default period_days if used by UI.
- Settings must not exceed analytics-service constraints.

---

## REST API Responsibilities

The web-app provides browser-facing REST API endpoints for:

- auth/session-related operations through NextAuth.js;
- analysis submission proxy/client flow;
- history access;
- saved report retrieval;
- flagged-address management;
- report export;
- user management;
- audit log access;
- system settings.

The web-app consumes analytics-service REST API for address analysis.

---

## Roles & Access Matrix

| Action | user | moderator | admin |
|---|---:|---:|---:|
| Login/logout | ✅ | ✅ | ✅ |
| View main menu | ✅ | ✅ | ✅ |
| Run analysis | ✅ | ✅ | ✅ |
| View generated report | ✅ | ✅ | ✅ |
| Export own report | ✅ | ✅ | ✅ |
| View own history | ✅ | ✅ | ✅ |
| View all users' history | ❌ | ❌ | ✅ |
| Re-open own saved analysis | ✅ | ✅ | ✅ |
| Re-open any saved analysis | ❌ | ❌ | ✅ |
| View flagged-address list | ❌ | ✅ | ✅ |
| Add flagged address manually | ❌ | ✅ | ✅ |
| Upload/import flagged addresses from file | ❌ | ❌ | ✅ |
| Remove duplicates during import | ❌ | ❌ | ✅ |
| Deactivate own flagged-address records | ❌ | ✅ | ✅ |
| Deactivate any flagged-address record | ❌ | ❌ | ✅ |
| Export flagged-address database | ❌ | ❌ | ✅ |
| User management | ❌ | ❌ | ✅ |
| View audit logs | ❌ | ❌ | ✅ |
| System settings | ❌ | ❌ | ✅ |

---

## Constraints

- ❌ NEVER add roles beyond: `user`, `moderator`, `admin`.
- ❌ NEVER show full flagged-address database to regular users.
- ❌ Moderator can ONLY deactivate flagged-address records where `created_by_user_id = current_user.id`.
- ❌ Admin history = all users; user/moderator history = own only.
- ❌ NEVER create duplicate users for the same OAuth account.
- ❌ NEVER expose raw SQL errors, stack traces, secrets, or internal exception text to API responses.
- ❌ NEVER parse analytics-service `detail` as machine-readable error logic.
- ✅ Branch analytics error UI by `error_code`.
- ✅ Validate address format before sending to analytics-service.
- ✅ TypeScript strict mode.
- ✅ Blocked users denied at middleware level.
- ✅ Failed login attempts written to `audit_logs`.
- ✅ All browser-facing API responses use JSON.
- ✅ External/public access must use HTTPS in deployed environment.
- ✅ Web-app calls analytics-service through internal service URL in k8s.
- ✅ Report can be generated both from a fresh analysis result and from saved history.
