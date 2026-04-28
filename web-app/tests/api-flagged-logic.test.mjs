// Unit tests for flagged-addresses route handler pure logic.
// Run with: node --test web-app/tests/api-flagged-logic.test.mjs
// Requires Node 22 (node:test built-in). No external dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Inline pure logic from route handlers ────────────────────────────────────

function parsePaginationParams(pageStr, limitStr) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const rawLimit = parseInt(limitStr ?? "20", 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function parseFilterParams(params) {
  const filters = {};
  if (params.network) filters.network = params.network;
  if (params.category) filters.category = params.category;
  if (params.search) filters.search = params.search;
  if (params.active !== undefined && params.active !== null) {
    filters.active = params.active !== "false";
  }
  return filters;
}

function authzResponse(authz) {
  if (!authz.ok) {
    if (authz.status === 500) return { status: 500, body: { error: "Authentication service unavailable" } };
    return {
      status: authz.status,
      body: { error: authz.status === 401 ? "Authentication required" : "Forbidden" },
    };
  }
  return null;
}

// Mirrors ownership check logic in PATCH/DELETE handlers
function checkOwnership(record, user) {
  if (user.role === "admin") return true;
  return record.created_by_user_id === user.id;
}

// Mirrors CSV escaping logic from export route
function escapeCsvField(v) {
  const s = v == null ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// Mirrors create body validation
function validateCreateBody(b) {
  const errors = [];
  const network_code = typeof b.network_code === "string" ? b.network_code.trim() : "";
  const address = typeof b.address === "string" ? b.address.trim() : "";
  const risk_category_code = typeof b.risk_category_code === "string" ? b.risk_category_code.trim() : "";

  if (!network_code) errors.push("network_code is required");
  if (!address || address.length < 10 || address.length > 128) {
    errors.push("address must be 10–128 characters");
  }
  if (!risk_category_code) errors.push("risk_category_code is required");
  return errors;
}

// Mirrors import deduplication: ON CONFLICT (network_id, address) DO NOTHING
function deduplicateImportRecords(records) {
  const seen = new Set();
  const unique = [];
  for (const r of records) {
    const key = `${r.network_code.toUpperCase()}:${r.address.trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }
  return unique;
}

// ─── Pagination tests ─────────────────────────────────────────────────────────

test("pagination defaults: no params → page=1, limit=20, offset=0", () => {
  const { page, limit, offset } = parsePaginationParams(undefined, undefined);
  assert.equal(page, 1);
  assert.equal(limit, 20);
  assert.equal(offset, 0);
});

test("pagination: page=2, limit=10 → offset=10", () => {
  const { page, limit, offset } = parsePaginationParams("2", "10");
  assert.equal(page, 2);
  assert.equal(limit, 10);
  assert.equal(offset, 10);
});

test("pagination: limit capped at 100", () => {
  const { limit } = parsePaginationParams("1", "9999");
  assert.equal(limit, 100);
});

test("pagination: limit=0 (falsy) falls back to default 20 (mirrors history route behavior)", () => {
  // parseInt("0") = 0, which is falsy, so `|| 20` kicks in before Math.min/max clamping.
  // This matches the existing GET /api/history pagination logic exactly.
  const { limit } = parsePaginationParams("1", "0");
  assert.equal(limit, 20);
});

test("pagination: invalid page string → defaults to 1", () => {
  const { page } = parsePaginationParams("abc", "20");
  assert.equal(page, 1);
});

// ─── Filter parsing tests ─────────────────────────────────────────────────────

test("filter: all params present", () => {
  const f = parseFilterParams({ network: "BTC", category: "scam", search: "1abc", active: "true" });
  assert.equal(f.network, "BTC");
  assert.equal(f.category, "scam");
  assert.equal(f.search, "1abc");
  assert.equal(f.active, true);
});

test("filter: active=false → false boolean", () => {
  const f = parseFilterParams({ active: "false" });
  assert.equal(f.active, false);
});

test("filter: active omitted → not in filters", () => {
  const f = parseFilterParams({});
  assert.equal("active" in f, false);
});

test("filter: empty search omitted", () => {
  const f = parseFilterParams({ search: "" });
  assert.equal("search" in f, false);
});

// ─── Auth guard response tests ────────────────────────────────────────────────

test("authzResponse: unauthenticated → 401", () => {
  const r = authzResponse({ ok: false, status: 401, reason: "unauthenticated" });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "Authentication required");
});

test("authzResponse: forbidden → 403", () => {
  const r = authzResponse({ ok: false, status: 403, reason: "forbidden" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "Forbidden");
});

test("authzResponse: db error → 500", () => {
  const r = authzResponse({ ok: false, status: 500, reason: "auth_unavailable" });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /unavailable/i);
});

test("authzResponse: ok → null (no early return)", () => {
  const r = authzResponse({ ok: true, user: { id: "u1", role: "moderator" } });
  assert.equal(r, null);
});

// ─── Ownership enforcement tests ──────────────────────────────────────────────

test("ownership: admin can modify any record", () => {
  const record = { created_by_user_id: "other-user" };
  const admin = { id: "admin-id", role: "admin" };
  assert.equal(checkOwnership(record, admin), true);
});

test("ownership: moderator can modify own record", () => {
  const record = { created_by_user_id: "mod-id" };
  const mod = { id: "mod-id", role: "moderator" };
  assert.equal(checkOwnership(record, mod), true);
});

test("ownership: moderator cannot modify another moderator's record", () => {
  const record = { created_by_user_id: "other-mod" };
  const mod = { id: "mod-id", role: "moderator" };
  assert.equal(checkOwnership(record, mod), false);
});

test("ownership: moderator cannot modify system record (null created_by)", () => {
  const record = { created_by_user_id: null };
  const mod = { id: "mod-id", role: "moderator" };
  assert.equal(checkOwnership(record, mod), false);
});

// ─── Create body validation tests ────────────────────────────────────────────

test("validate create: valid body → no errors", () => {
  const errors = validateCreateBody({
    network_code: "BTC",
    address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
    risk_category_code: "scam",
  });
  assert.equal(errors.length, 0);
});

test("validate create: missing network_code → error", () => {
  const errors = validateCreateBody({ address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", risk_category_code: "scam" });
  assert.ok(errors.some((e) => e.includes("network_code")));
});

test("validate create: address too short → error", () => {
  const errors = validateCreateBody({ network_code: "BTC", address: "short", risk_category_code: "scam" });
  assert.ok(errors.some((e) => e.includes("address")));
});

test("validate create: address too long → error", () => {
  const longAddr = "a".repeat(129);
  const errors = validateCreateBody({ network_code: "BTC", address: longAddr, risk_category_code: "scam" });
  assert.ok(errors.some((e) => e.includes("address")));
});

test("validate create: missing risk_category_code → error", () => {
  const errors = validateCreateBody({ network_code: "BTC", address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT" });
  assert.ok(errors.some((e) => e.includes("risk_category_code")));
});

// ─── Import deduplication tests ───────────────────────────────────────────────

test("import dedup: identical records collapsed to one", () => {
  const records = [
    { network_code: "BTC", address: "1abc123def456", risk_category_code: "scam" },
    { network_code: "BTC", address: "1abc123def456", risk_category_code: "mixer" },
  ];
  const unique = deduplicateImportRecords(records);
  assert.equal(unique.length, 1);
});

test("import dedup: same address different network → both kept", () => {
  const records = [
    { network_code: "BTC", address: "1abc123def456", risk_category_code: "scam" },
    { network_code: "ETH", address: "1abc123def456", risk_category_code: "scam" },
  ];
  const unique = deduplicateImportRecords(records);
  assert.equal(unique.length, 2);
});

test("import dedup: distinct addresses all kept", () => {
  const records = [
    { network_code: "BTC", address: "addr1111111111", risk_category_code: "scam" },
    { network_code: "BTC", address: "addr2222222222", risk_category_code: "scam" },
    { network_code: "BTC", address: "addr3333333333", risk_category_code: "scam" },
  ];
  const unique = deduplicateImportRecords(records);
  assert.equal(unique.length, 3);
});

test("import dedup: case-insensitive address dedup", () => {
  const records = [
    { network_code: "ETH", address: "0xABCDEF1234567890abcdef", risk_category_code: "scam" },
    { network_code: "ETH", address: "0xabcdef1234567890abcdef", risk_category_code: "mixer" },
  ];
  const unique = deduplicateImportRecords(records);
  assert.equal(unique.length, 1);
});

test("import dedup: network_code case-insensitive dedup", () => {
  const records = [
    { network_code: "btc", address: "1abc123def456", risk_category_code: "scam" },
    { network_code: "BTC", address: "1abc123def456", risk_category_code: "scam" },
  ];
  const unique = deduplicateImportRecords(records);
  assert.equal(unique.length, 1);
});

// ─── CSV export escaping tests ────────────────────────────────────────────────

test("csv escape: plain value passes through unchanged", () => {
  assert.equal(escapeCsvField("hello"), "hello");
});

test("csv escape: value with comma is quoted", () => {
  assert.equal(escapeCsvField("hello, world"), '"hello, world"');
});

test("csv escape: value with double-quote uses double-double-quote", () => {
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
});

test("csv escape: null/undefined → empty string", () => {
  assert.equal(escapeCsvField(null), "");
  assert.equal(escapeCsvField(undefined), "");
});

test("csv escape: newline in value is quoted", () => {
  const result = escapeCsvField("line1\nline2");
  assert.match(result, /^"/);
});
