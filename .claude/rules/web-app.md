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
- [x] NextAuth.js credentials baseline — email/password login only, JWT sessions, custom `/login` page, no password reset
- [x] GitHub OAuth login — `GitHubProvider` added to `web-app/auth.ts`; `signIn` callback calls `findOrCreateOAuthUser(provider, providerAccountId, email)` in `lib/db.ts` to upsert `users` + `oauth_accounts` + assign `user` role on first sign-in; email collision with existing credentials account links OAuth to the existing user without creating a duplicate row; blocked users (`is_blocked=TRUE`) denied in `signIn` callback; `jwt` callback populates `id`, `role`, `isBlocked` for OAuth path on first sign-in; subsequent token refreshes use cached claims; env vars required: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`; callback URL: `<NEXTAUTH_URL>/api/auth/callback/github`; "Sign in with GitHub" button added to `LoginForm.tsx`; "Continue with GitHub" button added to `SignUpForm.tsx`; OAuth-only accounts have `password_hash=NULL` and cannot sign in via credentials provider
- [x] User registration — `POST /api/register` accepts `{email, password}` JSON; validates email format and minimum 8-char password; normalizes email to lowercase; returns 400 on invalid input, 409 on duplicate email, 201 `{id, email}` on success; hashes password with bcryptjs (12 rounds) via `lib/password.ts`; inserts new user into `users` and assigns `user` role via `lib/db.ts#createUser()`; `/register` page with `SignUpForm` component that validates client-side, calls `POST /api/register`, then auto-signs in via `signIn("credentials")`; login page links to `/register`; `/api/register` is not in the middleware matcher (intentionally public)
- [x] DB-backed auth lookup — credentials sign-in reads existing Postgres `users`, `user_roles`, and `roles`; verifies `users.password_hash` with bcryptjs; denies login for missing role, invalid password, missing hash, or `users.is_blocked = TRUE`; if multiple roles exist, effective role is strongest by hierarchy `admin > moderator > user`
- [x] JWT/session claims — session token stores `id`, `email`, `role`, and `isBlocked`; allowed roles are exactly `user`, `moderator`, `admin`
- [x] Middleware RBAC foundation — `web-app/middleware.ts` protects `/dashboard`, `/analyze`, `/history/:path*`, `/admin/:path*`, `/moderator/:path*`, `/api/analyze`, `/api/history` (bare), `/api/history/:path*`, `/api/admin/:path*`, `/api/moderator/:path*`, and `/api/flagged-addresses/:path*`; unauthenticated page requests redirect to `/login`; unauthenticated API requests return JSON 401; insufficient-role or blocked-claim page requests redirect to `/unauthorized`; insufficient-role or blocked-claim API requests return JSON 403; `requiredRoleForPath` in `lib/rbac.ts` uses exact-match (`pathname === "/api/history"`) plus prefix-match (`startsWith("/api/history/")`) so the bare `GET /api/history` list route is enforced at the middleware layer, not only at the route handler layer
- [x] Blocked-user baseline — blocked users are denied at sign-in and denied by middleware when the JWT `isBlocked` claim is true; protected API/server guards re-check the database for sensitive actions such as `/api/analyze`
- [x] JWT limitation documented — middleware uses JWT claims, so role/block claims can be stale until token refresh/re-login; full database-backed sessions and immediate global session revocation are not implemented
- [x] Role-aware pages/menu — `/dashboard` shows role-appropriate actions; `/admin` is admin-only placeholder; `/moderator` is moderator/admin placeholder; `/unauthorized` handles denied page access; global navigation shows links according to the current session role
- [x] Admin seed script — `npm run seed:admin` runs `web-app/scripts/seed-admin.ts`, loads local env with Next's `@next/env` loader so seed-time env parsing matches the dev server, reads `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`, hashes the password with bcryptjs, ensures `admin` role exists, creates/updates the admin user, unblocks that user, updates the seeded admin password hash from `ADMIN_PASSWORD`, and ensures the admin role assignment without printing the password
- [x] Local auth/RBAC smoke verified (2026-04-27): Postgres and analytics-service were reached via local port-forwards; dev server ran on `0.0.0.0:3200` with ignored `.env.local`; `npm run seed:admin` created/updated a test admin without printing the password; unauthenticated `/analyze` and `/admin` redirected to `/login`; unauthenticated `POST /api/analyze` returned JSON 401; seeded admin login returned HTTP 200; `/dashboard`, `/admin`, and `/moderator` were accessible as admin; authenticated `POST /api/analyze` proxied successfully to analytics-service and returned HTTP 200 with `request_id`, `result_id`, `risk_level=MEDIUM`, `scoring_method=ml_model`, and `model_version=universal_xgboost_v1`; setting the test user `is_blocked=true` caused login to fail with HTTP 401; logging in while unblocked, then setting `is_blocked=true`, caused `POST /api/analyze` with the existing JWT cookie to return JSON 403 `reason=blocked` from the fresh DB check; the test user was restored to `is_blocked=false`
- [x] Transaction graph visualization (`web-app/components/TransactionGraph.tsx`) — interactive directed graph using `@xyflow/react` with dagre left-to-right layout; root address shown in indigo, flagged addresses in red, normal addresses in dark surface; directed edges with arrow markers and `N tx` labels; tooltip (title attr) on each edge shows `tx_count`, `total_amount`, `first_seen`, `last_seen`; zoom/pan/fit-view via built-in Controls; long addresses truncated to 8+6 chars; fallback visualization node created if edge references an address missing from `nodes`; empty state renders safe message when `edges.length === 0`; loaded via `next/dynamic` with `ssr: false`
- [x] Sankey transaction-flow diagram (`web-app/components/SankeyDiagram.tsx`) — root-centered depth-1 custom SVG flow diagram (no d3-sankey); incoming counterparties on the left, analyzed root address as a large centered rectangle, outgoing counterparties on the right; only root-adjacent edges are rendered (incoming: `edge.to_address == rootAddress`; outgoing: `edge.from_address == rootAddress`); deeper non-root edges ignored regardless of analysis depth; addresses compared after `trim().toLowerCase()`, original address preserved for display labels; parallel edges per counterparty collapsed by summing `tx_count` and `total_amount` and taking min/max timestamps; flow stroke width scaled by `sqrt(tx_count)` clamped to [2, 24] — `total_amount` does not affect width; `total_amount` shown only in SVG `<title>` tooltip alongside `tx_count`, `first_seen`, `last_seen`; same counterparty that both sends and receives appears in both left and right columns as separate entries; counterparties sorted descending by `tx_count`, capped at 20 per side; root/flagged/normal visual distinction maintained; responsive width via `ResizeObserver`; distinct empty state `"No root-adjacent transaction edges found — Sankey flow is not available."` when no root-adjacent edges; layout-error fallback `"Transaction flow layout could not be generated."`; legend for root/flagged/normal/incoming flow/outgoing flow; loaded via `next/dynamic` with `ssr: false`
- [x] Shared `ResultPanel` component (`web-app/components/ResultPanel.tsx`) — exports `ResultPanel`, `ResultData` interface, `RiskBadge`, `ScoreBar`, `FactorList`, `NodesTable`, `EdgesTable`, `FeaturesTable`; used by both `/analyze` and `/history/[id]`; accepts `ResultData` shape compatible with both `AnalyzeResponse` (fresh analysis) and the normalized history detail API response; `TransactionGraph` and `SankeyDiagram` loaded via `next/dynamic` with `ssr: false`
- [x] Analysis history module — `GET /api/history` returns paginated list (`page`, `limit` up to 100, default 20) of completed analyses; `user`/`moderator` see only own (`user_id` filter); `admin` sees all (no filter); both use fresh DB auth check via `authorizeFreshUser()`; response shape: `{ items, total, page, limit }`; `GET /api/history/[id]` returns full `ResultData`-compatible result (factors/features extracted from `factors_json` JSONB, edges normalized to `total_amount` + Unix-second timestamps, `network_code` aliased to `network`); ownership enforced: non-admin users receive 404 for results they do not own; both routes in `web-app/app/api/history/`; bug fixed: `getAnalysisHistory` count query previously used `$3` parameter placeholder but was passed only one binding — now uses separate `$1` placeholders for list and count queries (list: `$1=limit $2=offset $3=userId`; count: `$1=userId`), fixing `42P18` type-inference error from Postgres
- [x] History module test coverage — `web-app/tests/` contains test files runnable via `npm test` (Node 22 built-in `node:test`, no external test runner): (1) `rbac.test.mjs` — tests for `requiredRoleForPath` including bare `/api/history` exact-match fix and middleware decision simulation; (2) `api-history-logic.test.mjs` — route handler pure logic: auth guard (401/403/500), role→ownerFilter mapping, pagination param parsing (defaults, capping, invalid inputs), `factors_json` normalization, edge normalization (amount→total_amount, TIMESTAMPTZ→Unix seconds); (3) `db-history.test.mjs` — integration tests against live Postgres (skipped when `DATABASE_URL` unset): `getAnalysisHistory` ownership filter, admin no-filter, pagination, shape; `getAnalysisResult` owner access, non-owner → null, admin any-result, unknown ID → null; (4) `export-ui.test.mjs` — client-side saved-report export helpers for JSON serialization, JSON/HTML filenames, static HTML report content, empty report sections, and HTML escaping
- [x] History pages — `/history` (`web-app/app/history/page.tsx`) client component; fetches `/api/history`; paginated table with address, network, risk score, risk-level badge, analyzed-at, optional user column (admin view); "View" link to `/history/[id]`; empty-state prompt to run first analysis; `/history/[id]` (`web-app/app/history/[id]/page.tsx`) client component; fetches `/api/history/[id]`; renders full `ResultPanel`; "Export JSON" and "Export HTML" buttons trigger client-side downloads from the already loaded saved result; HTML export is a standalone static/tabular report and does not include the interactive TransactionGraph or SankeyDiagram; "← History" back link; 404/403 error states shown inline
- [x] Middleware and RBAC updated — `/history/:path*` added to middleware matcher; `requiredRoleForPath` returns `"user"` for `/history` and `/history/*`; unauthenticated page requests redirect to `/login`; unauthenticated API requests return JSON 401
- [x] Dashboard and nav updated — "Analysis history" card added to `/dashboard`; "History" link added to global nav for authenticated users

- [x] Audit logging — `logAuditEvent()` in `lib/db.ts` writes to `audit_logs` with best-effort fire-and-forget (errors swallowed, never thrown into the main flow); `userId` accepts `string | null`; `actor_role` stores the nullable role snapshot of the actor (`user`, `moderator`, `admin`) at event creation; historical/system/unknown-actor events may have `actor_role=NULL`; no passwords, hashes, tokens, or secrets are ever written to `details_json`; new events where role is purely actor identity do not store `role` in `details_json`; target-role details remain explicit as `old_role`/`new_role` or target metadata where needed; implemented events: `USER_CREATED`, `USER_ROLE_CHANGED`, `USER_BLOCKED`, `USER_UNBLOCKED`, `USER_DELETED`, `NETWORK_CONFIG_CHANGED` (admin actions); `USER_REGISTERED` (self-registration, userId = new user's id); `RUN_ANALYSIS` (all roles, on successful upstream 200); `FLAGGED_ADDRESS_CREATED`, `FLAGGED_ADDRESS_UPDATED`, `FLAGGED_ADDRESS_DEACTIVATED`, `FLAGGED_ADDRESS_REACTIVATED`, `FLAGGED_ADDRESS_IMPORT`, `FLAGGED_ADDRESS_EXPORT` (moderator/admin flagged-address flows); `LOGIN_SUCCESS`, `LOGIN_FAILURE` (reason is `wrong_password` | `blocked` | `missing_hash`; userId and actor_role are null when user not found), and `OAUTH_LOGIN_SUCCESS`; auth-flow logging is in `web-app/auth.ts` `authorize()` and `signIn` callback; all three auth events are fire-and-forget; historical events before Phase 3 have no login audit rows
- [x] Audit log viewer (admin-only) — `GET /api/admin/audit-logs` response items include `actor_role`; supported filters: `action` (exact), `userId` (exact), `email` (ILIKE substring on joined users.email), `role` (matches `audit_logs.actor_role`; `details_json.role` is not used for actor-role filtering), `entity` (exact), `dateFrom` (inclusive), `dateTo` (exclusive; date-only `YYYY-MM-DD` strings are normalized to end-of-day `T23:59:59.999Z` in the route handler); old rows with `actor_role=NULL` show a dash and do not match role filters; `page` + `limit` (default 20, max 100); `/admin/audit-logs` page has a filter bar with email search, role select, event-type select, dateFrom/dateTo date inputs plus a dedicated Role column; Details rendering hides a legacy `role` key but keeps `old_role`/`new_role`; viewer remains admin-only; filter changes reset to page 1; empty state updated to say "user and admin actions" instead of "admin actions only"
- [x] Web-app container/Kubernetes deployment readiness — `web-app/Dockerfile` builds a production Next.js image on Node.js 22 using `npm ci`, `npm run build`, and `npm run start`; `k8s/web-app/` contains ConfigMap, Secret placeholder, Deployment, Service, and deployment README. The Deployment uses image `risk-score-web-app:latest`, exposes port 3000, reads non-secret runtime config from `web-app-config`, reads `DATABASE_URL`, `AUTH_SECRET`, GitHub OAuth placeholders, and admin seed values from `web-app-secret`, and reaches analytics internally through `ANALYTICS_SERVICE_URL=http://analytics-service:8000`. The Service is ClusterIP-only; dev access is documented via `kubectl port-forward service/web-app 3200:3000`. No production Ingress is claimed. Existing PostgreSQL PVCs still require explicit SQL migrations; migrations are not automatically applied by the web-app manifests.

## NOT Implemented ❌
- [ ] Password reset
- [ ] Database-backed sessions / immediate global session revocation
- [ ] Add padding to "Sign In" button

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
- Implemented login: GitHub OAuth through `GitHubProvider`; blocked users denied in `signIn` callback.
- Implemented registration: `POST /api/register` → `lib/db.ts#createUser()` → `users` row + `user` role; auto-signs in after success.
- Not implemented: password reset.
- Email must be unique.
- Blocked users (`is_blocked = TRUE`) are denied at sign-in.
- Middleware denies requests when the JWT `isBlocked` claim is true.
- JWT middleware claims can be stale until token refresh/re-login.
- Protected API/server guards re-check DB state for sensitive actions such as `/api/analyze`.
- Full database-backed sessions / immediate global session revocation is NOT Implemented.
- Credentials login outcomes are written to `audit_logs`: `LOGIN_SUCCESS` on success; `LOGIN_FAILURE` (with reason `wrong_password`, `blocked`, or `missing_hash`) on failure.
- GitHub OAuth login success is written to `audit_logs` as `OAUTH_LOGIN_SUCCESS`.
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
- Report can be exported to file; saved history details support client-side JSON export and standalone static HTML export.
- PDF report export is NOT Implemented.

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
- Saved report can be exported from history as JSON or standalone static HTML without recomputation.
- HTML history export is client-side only and contains summary, factors, nodes, edges, and ML features as static/tabular content; interactive graph and Sankey visualizations are not exported.
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
- Reactivate:
  - reactivation sets `is_active = TRUE`;
  - moderator can reactivate only records where `created_by_user_id = current_user.id`;
  - admin can reactivate any record;
  - regular user cannot reactivate records.
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

Viewer: admin only.
Writers: all roles (see implemented events below).

Implemented events:
- `LOGIN_SUCCESS` — all roles (successful credentials login; `actor_role` stores the login user's role; `details: {email}`)
- `LOGIN_FAILURE` — all roles when the user is known, unknown otherwise (failed credentials login; `actor_role` stores the known user's role or NULL; `details: {email, reason}` — reason: `wrong_password` | `blocked` | `missing_hash`; userId null when user not found)
- `OAUTH_LOGIN_SUCCESS` — all roles (successful GitHub OAuth login; `actor_role` stores the OAuth user's role; `details: {email, provider}`)
- `USER_REGISTERED` — all users (self-registration; `actor_role: "user"`; `details: {email}`)
- `RUN_ANALYSIS` — all roles (successful analysis; `actor_role` stores the submitting user's role; `details: {address, network, risk_level, request_id, result_id}`)
- `FLAGGED_ADDRESS_CREATED` / `FLAGGED_ADDRESS_UPDATED` / `FLAGGED_ADDRESS_DEACTIVATED` / `FLAGGED_ADDRESS_REACTIVATED` — moderator + admin
- `FLAGGED_ADDRESS_IMPORT` / `FLAGGED_ADDRESS_EXPORT` — moderator + admin
- `USER_CREATED` / `USER_ROLE_CHANGED` / `USER_BLOCKED` / `USER_UNBLOCKED` / `USER_DELETED` — admin
- `NETWORK_CONFIG_CHANGED` — admin

No events are deferred. Historical rows before Phase 3 have no login audit entries.

Viewer filters: action, userId, email (substring), role (`audit_logs.actor_role`), entity, dateFrom, dateTo.
The audit viewer has a dedicated Role column for `actor_role`; `details_json.role` is not used for actor-role filtering or display. `USER_ROLE_CHANGED` keeps target-role details in `old_role` and `new_role`.
Raw SQL errors or internal stack traces must never be exposed through API responses.

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
| Reactivate own flagged-address records | ❌ | ✅ | ✅ |
| Reactivate any flagged-address record | ❌ | ❌ | ✅ |
| Export flagged-address database | ❌ | ❌ | ✅ |
| User management | ❌ | ❌ | ✅ |
| View audit logs | ❌ | ❌ | ✅ |
| System settings | ❌ | ❌ | ✅ |

---

## Constraints

- ❌ NEVER add roles beyond: `user`, `moderator`, `admin`.
- ❌ NEVER show full flagged-address database to regular users.
- ❌ Moderator can ONLY deactivate/reactivate flagged-address records where `created_by_user_id = current_user.id`.
- ❌ Admin history = all users; user/moderator history = own only.
- ❌ NEVER create duplicate users for the same OAuth account.
- ❌ NEVER expose raw SQL errors, stack traces, secrets, or internal exception text to API responses.
- ❌ NEVER parse analytics-service `detail` as machine-readable error logic.
- ✅ Branch analytics error UI by `error_code`.
- ✅ Validate address format before sending to analytics-service.
- ✅ TypeScript strict mode.
- ✅ Blocked users denied at middleware level.
- ✅ Auth-flow audit logging implemented — `LOGIN_SUCCESS`, `LOGIN_FAILURE` (with reason), and `OAUTH_LOGIN_SUCCESS` are written to `audit_logs` from `web-app/auth.ts`; fire-and-forget; no sensitive fields in details.
- ✅ All browser-facing API responses use JSON.
- ✅ External/public access must use HTTPS in deployed environment.
- ✅ Web-app calls analytics-service through internal service URL in k8s.
- ✅ Report can be generated both from a fresh analysis result and from saved history.
