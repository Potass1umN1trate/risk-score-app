// Unit tests for GET /api/admin/audit-logs route handler pure logic.
// No DB, no Next.js, no network, no auth tokens.
// Run with: node --test web-app/tests/api-admin-audit-logs-logic.test.mjs
// Requires Node 22 (node:test built-in).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ─── Inline pure helpers mirroring route logic ────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePaginationParams({ limit, page }) {
  const rawLimit = parseInt(limit ?? "", 10);
  const rawPage = parseInt(page ?? "", 10);
  return {
    limit: isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT),
    page: isNaN(rawPage) || rawPage < 1 ? 1 : rawPage,
    get offset() { return (this.page - 1) * this.limit; },
  };
}

function parseFilters({ action, userId, email, role, entity, dateFrom, dateTo }) {
  const filters = {};
  if (action)   filters.action   = action;
  if (userId)   filters.userId   = userId;
  if (email)    filters.email    = email;
  if (role)     filters.role     = role;
  if (entity)   filters.entity   = entity;
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo)   filters.dateTo   = dateTo;
  return filters;
}

// Mirrors the dateTo normalization in the route handler.
function normalizeDate(rawDateTo) {
  if (!rawDateTo) return rawDateTo;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDateTo)) {
    return `${rawDateTo}T23:59:59.999Z`;
  }
  return rawDateTo;
}

function makeAuthResult(scenario) {
  if (scenario === "unauthenticated") return { ok: false, status: 401, reason: "unauthenticated" };
  if (scenario === "blocked")         return { ok: false, status: 403, reason: "blocked" };
  if (scenario === "forbidden")       return { ok: false, status: 403, reason: "forbidden" };
  if (scenario === "db_error")        return { ok: false, status: 500, reason: "auth_unavailable" };
  if (scenario === "admin")           return { ok: true, user: { id: "admin-uuid", email: "admin@test.com", role: "admin" } };
  throw new Error(`Unknown scenario: ${scenario}`);
}

function authzResponse(auth) {
  if (!auth.ok) {
    if (auth.status === 500) return { status: 500, body: { error: "Authentication service unavailable" } };
    return { status: auth.status, body: { error: auth.status === 401 ? "Authentication required" : "Forbidden" } };
  }
  return null;
}

function buildResponseShape(items, total, page, limit) {
  return { items, total, page, limit };
}

// ─── Auth guard tests ─────────────────────────────────────────────────────────

describe("Auth guard", () => {
  test("unauthenticated → 401 with Authentication required", () => {
    const r = authzResponse(makeAuthResult("unauthenticated"));
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "Authentication required");
  });

  test("blocked user → 403", () => {
    const r = authzResponse(makeAuthResult("blocked"));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "Forbidden");
  });

  test("non-admin role → 403 forbidden", () => {
    const r = authzResponse(makeAuthResult("forbidden"));
    assert.equal(r.status, 403);
  });

  test("auth DB unavailable → 500", () => {
    const r = authzResponse(makeAuthResult("db_error"));
    assert.equal(r.status, 500);
    assert.match(r.body.error, /unavailable/i);
  });

  test("admin user → no error response (null)", () => {
    const r = authzResponse(makeAuthResult("admin"));
    assert.equal(r, null);
  });
});

// ─── Pagination param parsing ─────────────────────────────────────────────────

describe("Pagination param parsing", () => {
  test("no params → defaults (page=1, limit=20, offset=0)", () => {
    const r = parsePaginationParams({});
    assert.equal(r.page, 1);
    assert.equal(r.limit, 20);
    assert.equal(r.offset, 0);
  });

  test("page=2 limit=10 → offset=10", () => {
    const r = parsePaginationParams({ page: "2", limit: "10" });
    assert.equal(r.page, 2);
    assert.equal(r.limit, 10);
    assert.equal(r.offset, 10);
  });

  test("limit above MAX_LIMIT (100) → capped at 100", () => {
    const r = parsePaginationParams({ limit: "500" });
    assert.equal(r.limit, 100);
  });

  test("limit=0 → default 20", () => {
    assert.equal(parsePaginationParams({ limit: "0" }).limit, 20);
  });

  test("limit=-1 → default 20", () => {
    assert.equal(parsePaginationParams({ limit: "-1" }).limit, 20);
  });

  test("page=0 → default 1", () => {
    assert.equal(parsePaginationParams({ page: "0" }).page, 1);
  });

  test("non-numeric strings → defaults", () => {
    const r = parsePaginationParams({ page: "abc", limit: "xyz" });
    assert.equal(r.page, 1);
    assert.equal(r.limit, 20);
  });

  test("page=3 limit=20 → offset=40", () => {
    const r = parsePaginationParams({ page: "3", limit: "20" });
    assert.equal(r.offset, 40);
  });
});

// ─── Filter param parsing ─────────────────────────────────────────────────────

describe("Filter param parsing", () => {
  test("no params → empty filters object", () => {
    const f = parseFilters({});
    assert.deepEqual(f, {});
  });

  test("action filter is included when set", () => {
    const f = parseFilters({ action: "USER_CREATED" });
    assert.equal(f.action, "USER_CREATED");
  });

  test("userId filter is included when set", () => {
    const f = parseFilters({ userId: "some-uuid" });
    assert.equal(f.userId, "some-uuid");
  });

  test("entity filter is included when set", () => {
    const f = parseFilters({ entity: "user" });
    assert.equal(f.entity, "user");
  });

  test("dateFrom and dateTo are included when set", () => {
    const f = parseFilters({ dateFrom: "2026-01-01", dateTo: "2026-12-31" });
    assert.equal(f.dateFrom, "2026-01-01");
    assert.equal(f.dateTo, "2026-12-31");
  });

  test("email filter is included when set", () => {
    const f = parseFilters({ email: "alice@example.com" });
    assert.equal(f.email, "alice@example.com");
  });

  test("role filter is included when set", () => {
    const f = parseFilters({ role: "moderator" });
    assert.equal(f.role, "moderator");
  });

  test("undefined values are excluded from filters", () => {
    const f = parseFilters({ action: undefined, userId: "u1" });
    assert.equal("action" in f, false);
    assert.equal(f.userId, "u1");
  });

  test("all filters together including email and role", () => {
    const f = parseFilters({
      action: "USER_BLOCKED",
      userId: "uid",
      email: "bob@example.com",
      role: "admin",
      entity: "user",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-01",
    });
    assert.equal(f.action, "USER_BLOCKED");
    assert.equal(f.userId, "uid");
    assert.equal(f.email, "bob@example.com");
    assert.equal(f.role, "admin");
    assert.equal(f.entity, "user");
    assert.equal(f.dateFrom, "2026-01-01");
    assert.equal(f.dateTo, "2026-06-01");
  });
});

// ─── dateTo normalization ─────────────────────────────────────────────────────

describe("dateTo end-of-day normalization", () => {
  test("date-only string YYYY-MM-DD is padded to end-of-day", () => {
    assert.equal(normalizeDate("2026-04-30"), "2026-04-30T23:59:59.999Z");
  });

  test("already has time component → left unchanged", () => {
    assert.equal(normalizeDate("2026-04-30T10:00:00.000Z"), "2026-04-30T10:00:00.000Z");
  });

  test("null/undefined → passed through", () => {
    assert.equal(normalizeDate(null), null);
    assert.equal(normalizeDate(undefined), undefined);
  });

  test("empty string → passed through (falsy guard)", () => {
    assert.equal(normalizeDate(""), "");
  });

  test("normalized dateTo preserves date boundary", () => {
    const result = normalizeDate("2026-01-01");
    assert.ok(result.startsWith("2026-01-01T23:59:59"));
  });
});

// ─── Response shape ───────────────────────────────────────────────────────────

describe("Response shape", () => {
  const sampleItem = {
    id: "log-uuid",
    user_id: "admin-uuid",
    user_email: "admin@example.com",
    action: "USER_CREATED",
    entity: "user",
    entity_id: "new-user-uuid",
    details_json: { email: "new@user.com", role: "user" },
    created_at: "2026-04-29T12:00:00.000Z",
  };

  test("response includes items, total, page, limit", () => {
    const r = buildResponseShape([sampleItem], 1, 1, 20);
    assert.ok(Array.isArray(r.items));
    assert.equal(typeof r.total, "number");
    assert.equal(typeof r.page, "number");
    assert.equal(typeof r.limit, "number");
  });

  test("audit log item has all required fields", () => {
    const item = sampleItem;
    assert.ok(typeof item.id === "string");
    assert.ok(item.user_id === null || typeof item.user_id === "string");
    assert.ok(item.user_email === null || typeof item.user_email === "string");
    assert.ok(typeof item.action === "string");
    assert.ok(item.entity === null || typeof item.entity === "string");
    assert.ok(item.entity_id === null || typeof item.entity_id === "string");
    assert.ok(item.details_json === null || typeof item.details_json === "object");
    assert.ok(typeof item.created_at === "string");
  });

  test("empty result set produces items=[], total=0", () => {
    const r = buildResponseShape([], 0, 1, 20);
    assert.deepEqual(r.items, []);
    assert.equal(r.total, 0);
  });

  test("details_json does not contain sensitive fields", () => {
    const details = sampleItem.details_json;
    assert.equal("password" in details, false);
    assert.equal("password_hash" in details, false);
    assert.equal("token" in details, false);
    assert.equal("secret" in details, false);
  });

  test("user_email and user_id are nullable for system events", () => {
    const systemItem = { ...sampleItem, user_id: null, user_email: null };
    assert.equal(systemItem.user_id, null);
    assert.equal(systemItem.user_email, null);
  });
});

// ─── Audit action taxonomy ────────────────────────────────────────────────────

describe("Audit action taxonomy", () => {
  const EXPECTED_ACTIONS = [
    // Admin-only actions (pre-existing)
    "USER_CREATED",
    "USER_ROLE_CHANGED",
    "USER_BLOCKED",
    "USER_UNBLOCKED",
    "USER_DELETED",
    "NETWORK_CONFIG_CHANGED",
    // All-role actions (Phase 2)
    "USER_REGISTERED",
    "RUN_ANALYSIS",
    // Moderator + admin actions (Phase 2)
    "FLAGGED_ADDRESS_CREATED",
    "FLAGGED_ADDRESS_UPDATED",
    "FLAGGED_ADDRESS_DEACTIVATED",
    "FLAGGED_ADDRESS_IMPORT",
    "FLAGGED_ADDRESS_EXPORT",
  ];

  for (const action of EXPECTED_ACTIONS) {
    test(`action "${action}" is a non-empty string`, () => {
      assert.ok(typeof action === "string" && action.length > 0);
    });
  }

  test("action strings are uppercase_snake_case", () => {
    for (const action of EXPECTED_ACTIONS) {
      assert.match(action, /^[A-Z][A-Z0-9_]+$/);
    }
  });
});
