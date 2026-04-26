# Web Application

**Stack**: Next.js 15, TypeScript, NextAuth.js, Node.js 22 LTS
**Role**: Browser-facing UI + REST API + RBAC + audit logging

---

## Implemented ✅
- [ ] fill after reviewing web-app directory

## NOT Implemented ❌
- [ ] Frontend UI (analysis form, graph visualization, history page)
- [ ] NextAuth.js auth (email+password, GitHub OAuth)
- [ ] RBAC middleware (user/moderator/admin)
- [ ] Admin: user management, audit logs, system settings
- [ ] Moderator + Admin: view flagged-address list; Moderator: add flagged address (risk_category + comment required), deactivate own records only; Admin: deactivate any record, import/export
- [ ] Report export (analysis result → file)

---

## Functions

### Auth
- Registration: email + password (unique email validation)
- Login: email+password OR GitHub OAuth (NextAuth.js)
- No duplicate users: same OAuth account → same user record
- Blocked users (`is_blocked = TRUE`) denied at middleware level
- Failed login attempts → audit_logs

### Analysis
- Form: address input + network selector + depth + tx_limit (+ optional period_days)
- Submit → POST to analytics-service → show result (risk_score, risk_level, graph)
- Validate address format before sending to analytics-service
- On non-200 response: parse `error_code` field and branch UI by code (see table below)

| `error_code` | UI behaviour |
|---|---|
| `INVALID_REQUEST` | Inline/form-level message: "Invalid request. Check your inputs and try again." |
| `INVALID_ADDRESS` | Inline form error on the address field |
| `UNSUPPORTED_NETWORK` | Inline form error on the network selector |
| `BLOCKCHAIN_RATE_LIMITED` | Toast/banner: "Data provider is rate-limiting — please wait and retry" |
| `BLOCKCHAIN_UNAVAILABLE` | Toast/banner: "Blockchain data is temporarily unavailable — try again later" |
| `INTERNAL_ERROR` | Toast/banner: "Something went wrong. Please try again." |
| unknown / missing | Treat as `INTERNAL_ERROR` |

- ❌ NEVER parse the human-readable `detail` string to decide which error to show

### History
- List of own analyses (user/moderator), all analyses (admin)
- Re-open saved result (no recompute)
- Export report to file
- History API and history access control are web-app responsibilities; analytics-service only persists analysis records and does not expose public history endpoints


### Flagged Addresses
- View list: moderator + admin only
- Add record: moderator + admin (risk_category + comment required)
- Deactivate: moderator = own records only; admin = any record (soft delete)
- Import from file / export to file: admin only (deduplication on import)

### User Management (admin only)
- List accounts, change role, block/unblock

### Audit Log (admin only)
- View journal: LOGIN, RUN_ANALYSIS, ADD_FLAGGED, DEACTIVATE_FLAGGED, etc.

### System Settings (admin only)
- Default analysis parameters (depth, tx_limit)

---

## Roles & Access Matrix
| Action | user | moderator | admin |
|---|---|---|---|
| Run analysis | ✅ | ✅ | ✅ |
| View own history | ✅ | ✅ | ✅ |
| View all history | ❌ | ❌ | ✅ |
| View flagged addresses | ❌ | ✅ | ✅ |
| Add flagged address | ❌ | ✅ | ✅ |
| Deactivate own flagged | ❌ | ✅ | ✅ |
| Deactivate any flagged | ❌ | ❌ | ✅ |
| Import/export flagged | ❌ | ❌ | ✅ |
| User management | ❌ | ❌ | ✅ |
| View audit logs | ❌ | ❌ | ✅ |
| System settings | ❌ | ❌ | ✅ |

---

## Constraints
- ❌ NEVER add roles beyond: `user`, `moderator`, `admin`
- ❌ Moderator can ONLY deactivate flagged addresses where `created_by_user_id = current_user.id`
- ❌ Admin history = ALL users; User/Moderator = OWN only
- ❌ NEVER create duplicate users for same OAuth account
- ❌ NEVER expose raw SQL errors to API responses
- ✅ All external client API: HTTPS + JSON
- ✅ TypeScript strict mode
- ✅ Blocked users denied at middleware — not just UI level
- ✅ Log failed login attempts to audit_logs
- ✅ Validate address format BEFORE sending to analytics-service
- ✅ Branch UI error display by `error_code` field — NEVER parse `detail` string
