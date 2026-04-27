# Web Application

**Stack**: Next.js 15, TypeScript, NextAuth.js, Node.js 22 LTS  
**Role**: Browser-facing UI + REST API layer + authentication + RBAC + analysis workflow + reports + flagged-address management + history + audit logging

---

## Implemented ✅
- [x] Next.js 15.5.15 project scaffold — App Router, TypeScript strict mode, Node.js 22 LTS, npm
- [x] `web-app/lib/analytics.ts` — typed analytics-service client; defines `AnalyzeRequest`, `AnalyzeResponse`, `NodeOut`, `EdgeOut`, `RiskFactor`, `AnalyticsErrorResponse`, known `AnalyticsErrorCode` values; `submitAnalysis()` browser helper posts to web-app `/api/analyze` proxy (never directly to analytics-service)
- [x] `web-app/app/api/analyze/route.ts` — server-side proxy `POST /api/analyze`; reads `ANALYTICS_SERVICE_URL` env var; forwards request to analytics-service; passes status code through; returns structured `INTERNAL_ERROR` on unreachable service; never exposes raw stack traces
- [x] `web-app/app/analyze/page.tsx` — analysis form (address, network, depth, tx_limit, optional period_days); client-side validation before submit; loading state; result rendering (risk_score, risk_level, scoring_method, model_version, flag_type, factors, nodes table, edges table with first_seen/last_seen, ML features table, analyzed_at)
- [x] Structured error handling by `error_code` — `INVALID_ADDRESS` → address field error; `UNSUPPORTED_NETWORK` → network field error; `BLOCKCHAIN_RATE_LIMITED` / `BLOCKCHAIN_UNAVAILABLE` → warning banner; `INVALID_REQUEST` / `INTERNAL_ERROR` / unknown → error banner; `detail` string is never parsed for UI logic
- [x] `web-app/app/page.tsx` — minimal landing page with link to `/analyze`
- [x] `web-app/.env.example` — documents `ANALYTICS_SERVICE_URL` for local (`http://127.0.0.1:8000`) and k8s in-cluster (`http://analytics-service:8000`) use
- [x] Global CSS with dark theme, no external UI library
- [x] Local web-app smoke verified (2026-04-27): dev server on `0.0.0.0:3000` via `npm run dev -- --hostname 0.0.0.0`; `ANALYTICS_SERVICE_URL` loaded from `.env.local`, confirmed server-side only (not present in client JS bundles); `/api/analyze` proxy success path returns HTTP 200 with `risk_score`, `risk_level`, `request_id`, `result_id`, `scoring_method=ml_model`, `model_version=universal_xgboost_v1`, 27 features, 2 factors; `UNSUPPORTED_NETWORK` returns HTTP 400 with `request_id=null`; `INVALID_ADDRESS` returns HTTP 400 with `request_id=null`; service-unavailable returns HTTP 500 `INTERNAL_ERROR` with no stack trace; browser renders result panel, inline address error, and banner error correctly; browser calls `/api/analyze` proxy only, never `127.0.0.1:8000` directly
- [x] Transaction graph visualization (`web-app/components/TransactionGraph.tsx`) — interactive directed graph using `@xyflow/react` with dagre left-to-right layout; root address shown in indigo, flagged addresses in red, normal addresses in dark surface; directed edges with arrow markers and `N tx` labels; tooltip (title attr) on each edge shows `tx_count`, `total_amount`, `first_seen`, `last_seen`; zoom/pan/fit-view via built-in Controls; long addresses truncated to 8+6 chars; fallback visualization node created if edge references an address missing from `nodes`; empty state renders safe message when `edges.length === 0`; loaded via `next/dynamic` with `ssr: false`
- [x] Sankey transaction-flow diagram (`web-app/components/SankeyDiagram.tsx`) — SVG Sankey using `d3-sankey`; source/target = from_address/to_address using stable numeric array indexes (no `.nodeId()` override); flow value = `total_amount` when > 0 else `tx_count`; parallel edges between same address pair collapsed into one link; root address in indigo, flagged in red, normal in slate; native SVG `<title>` on each link exposes `tx_count`, `total_amount`, `first_seen`, `last_seen` on hover; responsive width via `ResizeObserver`; legend for root/flagged/normal; distinct empty state when `edges.length === 0` vs layout-error fallback; loaded via `next/dynamic` with `ssr: false`

## NOT Implemented ❌
- [ ] Frontend UI: authorization pages, main menu, history page, flagged-address pages
- [ ] Report export to file
- [ ] Web-app REST API for history, flagged-address management, user management, audit log, system settings
- [ ] Analysis history: own history for user/moderator, all history for admin
- [ ] Re-open saved analysis result without recomputation
- [ ] NextAuth.js auth: email+password and GitHub OAuth
- [ ] RBAC middleware: user / moderator / admin
- [ ] Blocked-user enforcement at middleware level
- [ ] Audit logging: failed login, analysis run, flagged-address changes, admin actions
- [ ] Moderator + Admin: view flagged-address list
- [ ] Moderator + Admin: add flagged address manually with risk_category + comment
- [ ] Moderator: deactivate only own flagged-address records
- [ ] Admin: deactivate any flagged-address record
- [ ] Admin: import/export flagged-address database
- [ ] Admin: user management
- [ ] Admin: audit log view
- [ ] Admin: system settings for default analysis parameters
- [ ] Web-app container/k8s deployment and internal connection to analytics-service
- [ ] Fix transaction graph/Sankey address normalization and Sankey empty-state bug

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

- Registration: email + password.
- Login: email + password OR GitHub OAuth through NextAuth.js.
- Email must be unique.
- Same OAuth account must map to the same user record.
- Blocked users (`is_blocked = TRUE`) are denied at middleware level, not only hidden in UI.
- Failed login attempts are written to `audit_logs`.
- Successful login determines the user role: `user`, `moderator`, or `admin`.
- After successful login, user is redirected to the main menu/dashboard.

### Main Menu / Dashboard

The main menu displays actions available to the current role:

- Run address analysis.
- View analysis history.
- Manage flagged-address database, only for moderator/admin.
- User management, only for admin.
- Audit log, only for admin.
- System settings, only for admin.
- Logout.

The menu must not show actions unavailable to the current role, but backend/API access control must still enforce permissions.

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