// Unit tests for route handler decision logic — no Next.js or DB dependency.
// Tests the pure functions that govern auth branching, pagination parsing,
// role→ownerFilter mapping, and response normalization for both history routes.
// Run: node --test web-app/tests/api-history-logic.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Inline pure logic from route.ts files ───────────────────────────────────

// Mirrors GET /api/history pagination parameter parsing
function parsePaginationParams(pageStr, limitStr) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const rawLimit = parseInt(limitStr ?? "20", 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// Mirrors role → ownerFilter mapping used in both routes
function ownerFilterForRole(role, userId) {
  const isAdmin = role === "admin";
  return isAdmin ? null : userId;
}

// Mirrors authz guard response logic in both routes
function authzResponse(authz) {
  if (!authz.ok) {
    if (authz.status === 500) return { status: 500, body: { error: "Authentication service unavailable" } };
    return {
      status: authz.status,
      body: { error: authz.status === 401 ? "Authentication required" : "Forbidden" },
    };
  }
  return null; // no early return — continue to handler
}

// Mirrors the detail route response normalization (factors_json → factors/features)
function normalizeFactorsJson(factorsJson) {
  const fj = factorsJson;
  const factors = Array.isArray(fj?.factors) ? fj.factors : [];
  const features =
    fj?.features && typeof fj.features === "object" && !Array.isArray(fj.features)
      ? fj.features
      : {};
  return { factors, features };
}

// Mirrors edge normalization: DB amount + TIMESTAMPTZ → total_amount + Unix seconds
function normalizeEdge(e) {
  return {
    from_address: e.from_address,
    to_address: e.to_address,
    tx_count: e.tx_count,
    total_amount: parseFloat(e.amount ?? "0"),
    first_seen: e.first_seen ? Math.floor(new Date(e.first_seen).getTime() / 1000) : null,
    last_seen: e.last_seen ? Math.floor(new Date(e.last_seen).getTime() / 1000) : null,
  };
}

// ─── Auth guard tests ─────────────────────────────────────────────────────────

test("auth guard: unauthenticated (no session) → 401", () => {
  const authz = { ok: false, status: 401, reason: "unauthenticated" };
  const resp = authzResponse(authz);
  assert.equal(resp.status, 401);
  assert.equal(resp.body.error, "Authentication required");
});

test("auth guard: blocked user → 403", () => {
  const authz = { ok: false, status: 403, reason: "blocked" };
  const resp = authzResponse(authz);
  assert.equal(resp.status, 403);
  assert.equal(resp.body.error, "Forbidden");
});

test("auth guard: insufficient role → 403", () => {
  const authz = { ok: false, status: 403, reason: "forbidden" };
  const resp = authzResponse(authz);
  assert.equal(resp.status, 403);
});

test("auth guard: DB unavailable during auth check → 500", () => {
  const authz = { ok: false, status: 500, reason: "auth_unavailable" };
  const resp = authzResponse(authz);
  assert.equal(resp.status, 500);
  assert.ok(resp.body.error.includes("unavailable"));
});

test("auth guard: authorized user → no early return (null)", () => {
  const authz = { ok: true, user: { id: "user-1", role: "user" } };
  assert.equal(authzResponse(authz), null);
});

// ─── Role → ownerFilter mapping tests ────────────────────────────────────────

test("ownerFilter: user role → own userId", () => {
  assert.equal(ownerFilterForRole("user", "user-abc"), "user-abc");
});

test("ownerFilter: moderator role → own userId (not admin)", () => {
  assert.equal(ownerFilterForRole("moderator", "mod-xyz"), "mod-xyz");
});

test("ownerFilter: admin role → null (sees all)", () => {
  assert.equal(ownerFilterForRole("admin", "admin-id"), null);
});

// ─── Pagination parsing tests ─────────────────────────────────────────────────

test("pagination: defaults to page=1, limit=20", () => {
  const { page, limit, offset } = parsePaginationParams(null, null);
  assert.equal(page, 1);
  assert.equal(limit, 20);
  assert.equal(offset, 0);
});

test("pagination: page=2 limit=10 → offset=10", () => {
  const { page, limit, offset } = parsePaginationParams("2", "10");
  assert.equal(page, 2);
  assert.equal(limit, 10);
  assert.equal(offset, 10);
});

test("pagination: limit capped at 100", () => {
  const { limit } = parsePaginationParams("1", "999");
  assert.equal(limit, 100);
});

test("pagination: limit=0 is treated as invalid and defaults to 20", () => {
  // parseInt("0") || 20 short-circuits to 20 — zero is treated as unset
  const { limit } = parsePaginationParams("1", "0");
  assert.equal(limit, 20);
});

test("pagination: page minimum is 1 (no negative pages)", () => {
  const { page, offset } = parsePaginationParams("-5", "20");
  assert.equal(page, 1);
  assert.equal(offset, 0);
});

test("pagination: non-numeric page string defaults to page=1", () => {
  const { page } = parsePaginationParams("abc", "20");
  assert.equal(page, 1);
});

test("pagination: non-numeric limit string defaults to limit=20", () => {
  const { limit } = parsePaginationParams("1", "bad");
  assert.equal(limit, 20);
});

// ─── factors_json normalization tests ────────────────────────────────────────

test("normalizeFactorsJson: extracts factors and features from JSONB blob", () => {
  const fj = {
    scoring_method: "ml_model",
    factors: [{ key: "k1", label: "L1", value: 1, severity: "LOW", description: "d" }],
    features: { tx_in_count: 5, tx_out_count: 3 },
  };
  const { factors, features } = normalizeFactorsJson(fj);
  assert.equal(factors.length, 1);
  assert.equal(factors[0].key, "k1");
  assert.equal(features.tx_in_count, 5);
});

test("normalizeFactorsJson: null blob → empty factors and features", () => {
  const { factors, features } = normalizeFactorsJson(null);
  assert.deepEqual(factors, []);
  assert.deepEqual(features, {});
});

test("normalizeFactorsJson: missing factors key → empty array", () => {
  const { factors } = normalizeFactorsJson({ scoring_method: "database" });
  assert.deepEqual(factors, []);
});

test("normalizeFactorsJson: factors is not an array → empty array", () => {
  const { factors } = normalizeFactorsJson({ factors: "bad" });
  assert.deepEqual(factors, []);
});

test("normalizeFactorsJson: features is array → treated as empty object", () => {
  const { features } = normalizeFactorsJson({ features: [1, 2, 3] });
  assert.deepEqual(features, {});
});

// ─── Edge normalization tests ─────────────────────────────────────────────────

test("normalizeEdge: converts amount string to total_amount float", () => {
  const edge = normalizeEdge({
    from_address: "addr1", to_address: "addr2", tx_count: 3,
    amount: "0.00123456", first_seen: null, last_seen: null,
  });
  assert.ok(Math.abs(edge.total_amount - 0.00123456) < 1e-10);
});

test("normalizeEdge: null amount → total_amount 0", () => {
  const edge = normalizeEdge({
    from_address: "a", to_address: "b", tx_count: 1,
    amount: null, first_seen: null, last_seen: null,
  });
  assert.equal(edge.total_amount, 0);
});

test("normalizeEdge: TIMESTAMPTZ string → Unix seconds integer", () => {
  const ts = "2024-03-15T10:30:00.000Z";
  const edge = normalizeEdge({
    from_address: "a", to_address: "b", tx_count: 1, amount: "1",
    first_seen: ts, last_seen: ts,
  });
  const expected = Math.floor(new Date(ts).getTime() / 1000);
  assert.equal(edge.first_seen, expected);
  assert.equal(edge.last_seen, expected);
});

test("normalizeEdge: null timestamps → null", () => {
  const edge = normalizeEdge({
    from_address: "a", to_address: "b", tx_count: 1, amount: "1",
    first_seen: null, last_seen: null,
  });
  assert.equal(edge.first_seen, null);
  assert.equal(edge.last_seen, null);
});

test("normalizeEdge: preserves from_address, to_address, tx_count", () => {
  const edge = normalizeEdge({
    from_address: "fromX", to_address: "toY", tx_count: 7,
    amount: "2.5", first_seen: null, last_seen: null,
  });
  assert.equal(edge.from_address, "fromX");
  assert.equal(edge.to_address, "toY");
  assert.equal(edge.tx_count, 7);
});
