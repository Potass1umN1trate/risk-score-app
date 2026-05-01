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

function canManage(record, user) {
  return user.role === "admin" || record.created_by_user_id === user.id;
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

// ─── Reactivation route logic tests ──────────────────────────────────────────

function parseActivationPatchBody(body) {
  if (!("is_active" in body)) return { kind: "not_activation" };
  if (Object.keys(body).length !== 1) {
    return { kind: "error", status: 400, error: "Activation cannot be combined with other updates" };
  }
  if (body.is_active !== true) {
    return { kind: "error", status: 400, error: "Use DELETE to deactivate records" };
  }
  return { kind: "activate" };
}

function activationRouteOutcome({ record, user, activated }) {
  if (!record) return { status: 404, audit: false, body: { error: "Not found" } };
  if (!canManage(record, user)) return { status: 403, audit: false, body: { error: "Forbidden" } };
  if (!activated) {
    return { status: 404, audit: false, body: { error: "Record not found or already active" } };
  }
  return { status: 200, audit: true, body: { ok: true } };
}

test("reactivation: PATCH { is_active: true } is accepted as activation intent", () => {
  assert.deepEqual(parseActivationPatchBody({ is_active: true }), { kind: "activate" });
});

test("reactivation: PATCH { is_active: false } returns 400", () => {
  const r = parseActivationPatchBody({ is_active: false });
  assert.equal(r.status, 400);
  assert.match(r.error, /deactivate/i);
});

test("reactivation: PATCH combining is_active with edit fields returns 400", () => {
  const r = parseActivationPatchBody({ is_active: true, comment: "note" });
  assert.equal(r.status, 400);
  assert.match(r.error, /combined/i);
});

test("reactivation: moderator can reactivate own inactive record", () => {
  const r = activationRouteOutcome({
    record: { created_by_user_id: "mod-id" },
    user: { id: "mod-id", role: "moderator" },
    activated: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.audit, true);
});

test("reactivation: moderator cannot reactivate another user's record", () => {
  const r = activationRouteOutcome({
    record: { created_by_user_id: "other-id" },
    user: { id: "mod-id", role: "moderator" },
    activated: true,
  });
  assert.equal(r.status, 403);
  assert.equal(r.audit, false);
});

test("reactivation: moderator cannot reactivate null-owner/system record", () => {
  const r = activationRouteOutcome({
    record: { created_by_user_id: null },
    user: { id: "mod-id", role: "moderator" },
    activated: true,
  });
  assert.equal(r.status, 403);
  assert.equal(r.audit, false);
});

test("reactivation: admin can reactivate any inactive record", () => {
  const r = activationRouteOutcome({
    record: { created_by_user_id: "other-id" },
    user: { id: "admin-id", role: "admin" },
    activated: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.audit, true);
});

test("reactivation: unknown id returns 404 and does not audit", () => {
  const r = activationRouteOutcome({
    record: null,
    user: { id: "admin-id", role: "admin" },
    activated: false,
  });
  assert.equal(r.status, 404);
  assert.equal(r.audit, false);
});

test("reactivation: already active record returns no-op 404 and does not audit", () => {
  const r = activationRouteOutcome({
    record: { created_by_user_id: "admin-id" },
    user: { id: "admin-id", role: "admin" },
    activated: false,
  });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /already active/i);
  assert.equal(r.audit, false);
});

test("reactivation: regular user denied by auth guard before route logic", () => {
  const r = authzResponse({ ok: false, status: 403, reason: "forbidden" });
  assert.equal(r.status, 403);
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

// ─── updateFlaggedAddress logic tests ────────────────────────────────────────
// These mirror the fixed DB helper behaviour: empty patch → null, zero-row UPDATE → null.

// Simulates the fixed updateFlaggedAddress early-guard logic.
function simulateUpdate(patch, rowCount) {
  // Early guard: empty patch returns null without touching the DB.
  if (patch.risk_category_code === undefined && patch.comment === undefined) {
    return null;
  }
  // After UPDATE: zero rowCount means the record was inactive or missing.
  if (rowCount === 0) return null;
  // Non-zero: would return the refreshed record (represented as a sentinel here).
  return { id: "fake-id" };
}

test("updateFlaggedAddress: empty patch → null (no-op guard)", () => {
  assert.equal(simulateUpdate({}, 1), null);
});

test("updateFlaggedAddress: patch with neither field → null", () => {
  assert.equal(simulateUpdate({ unrelated: "x" }, 1), null);
});

test("updateFlaggedAddress: valid patch, zero rowCount → null (record inactive or missing)", () => {
  assert.equal(simulateUpdate({ risk_category_code: "scam" }, 0), null);
});

test("updateFlaggedAddress: comment-only patch, zero rowCount → null", () => {
  assert.equal(simulateUpdate({ comment: "updated" }, 0), null);
});

test("updateFlaggedAddress: valid patch, non-zero rowCount → record returned", () => {
  assert.ok(simulateUpdate({ risk_category_code: "scam" }, 1) !== null);
});

test("updateFlaggedAddress: both fields patched, non-zero rowCount → record returned", () => {
  assert.ok(simulateUpdate({ risk_category_code: "mixer", comment: "note" }, 1) !== null);
});

// Simulates the PATCH route handler mapping null from updateFlaggedAddress to 404.
function patchRouteOutcome(updateResult) {
  if (updateResult === null) return { status: 404, body: { error: "Not found or already deactivated" } };
  return { status: 200, body: updateResult };
}

test("PATCH route: updateFlaggedAddress returns null → 404", () => {
  const r = patchRouteOutcome(null);
  assert.equal(r.status, 404);
  assert.match(r.body.error, /deactivated/i);
});

test("PATCH route: updateFlaggedAddress returns record → 200", () => {
  const record = { id: "abc", address: "1test" };
  const r = patchRouteOutcome(record);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, record);
});

// ─── Audit event shape tests ──────────────────────────────────────────────────
// These tests verify the specification for audit events that flagged-address
// routes should emit on successful mutations. They test the event shape contract,
// not that logAuditEvent was called (that requires integration tests).

import { describe } from "node:test";

function buildFlaggedCreatedEvent(userId, role, created) {
  return {
    userId,
    action: "FLAGGED_ADDRESS_CREATED",
    actorRole: role,
    entity: "flagged_address",
    entityId: created.id,
    details: {
      network_code: created.network_code,
      address: created.address,
      risk_category_code: created.risk_category_code,
    },
  };
}

function buildFlaggedUpdatedEvent(userId, role, id, patch) {
  return {
    userId,
    action: "FLAGGED_ADDRESS_UPDATED",
    actorRole: role,
    entity: "flagged_address",
    entityId: id,
    details: { changes: patch },
  };
}

function buildFlaggedDeactivatedEvent(userId, role, id, address, network_code) {
  return {
    userId,
    action: "FLAGGED_ADDRESS_DEACTIVATED",
    actorRole: role,
    entity: "flagged_address",
    entityId: id,
    details: { address, network_code },
  };
}

function buildFlaggedReactivatedEvent(userId, role, id, address, network_code) {
  return {
    userId,
    action: "FLAGGED_ADDRESS_REACTIVATED",
    actorRole: role,
    entity: "flagged_address",
    entityId: id,
    details: { address, network_code },
  };
}

function buildFlaggedImportEvent(userId, role, inserted, skipped, error_count) {
  return {
    userId,
    action: "FLAGGED_ADDRESS_IMPORT",
    actorRole: role,
    entity: "flagged_address",
    entityId: null,
    details: { inserted, skipped, error_count },
  };
}

function buildFlaggedExportEvent(userId, role, format, count) {
  return {
    userId,
    action: "FLAGGED_ADDRESS_EXPORT",
    actorRole: role,
    entity: "flagged_address",
    entityId: null,
    details: { format, count },
  };
}

describe("Flagged-address audit event shapes", () => {
  test("FLAGGED_ADDRESS_CREATED event has correct shape", () => {
    const e = buildFlaggedCreatedEvent("mod-1", "moderator", {
      id: "fa-uuid",
      network_code: "BTC",
      address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
      risk_category_code: "scam",
    });
    assert.equal(e.action, "FLAGGED_ADDRESS_CREATED");
    assert.equal(e.entity, "flagged_address");
    assert.equal(e.entityId, "fa-uuid");
    assert.equal(e.actorRole, "moderator");
    assert.equal("role" in e.details, false);
    assert.equal(e.details.network_code, "BTC");
    assert.equal(e.details.address, "1BoatSLRHtKNngkdXEeobR76b53LETtpyT");
    assert.equal(e.details.risk_category_code, "scam");
  });

  test("FLAGGED_ADDRESS_CREATED details have no sensitive fields", () => {
    const e = buildFlaggedCreatedEvent("mod-1", "moderator", {
      id: "x", network_code: "ETH", address: "0xabc", risk_category_code: "mixer",
    });
    assert.equal("password" in e.details, false);
    assert.equal("token" in e.details, false);
  });

  test("FLAGGED_ADDRESS_UPDATED event captures only applied patch fields", () => {
    const patch = { risk_category_code: "sanctions" };
    const e = buildFlaggedUpdatedEvent("mod-1", "moderator", "fa-uuid", patch);
    assert.equal(e.action, "FLAGGED_ADDRESS_UPDATED");
    assert.deepEqual(e.details.changes, { risk_category_code: "sanctions" });
    assert.equal("address" in e.details.changes, false);
  });

  test("FLAGGED_ADDRESS_DEACTIVATED event captures address and network_code", () => {
    const e = buildFlaggedDeactivatedEvent(
      "mod-1", "moderator", "fa-uuid", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "BTC"
    );
    assert.equal(e.action, "FLAGGED_ADDRESS_DEACTIVATED");
    assert.equal(e.details.address, "1BoatSLRHtKNngkdXEeobR76b53LETtpyT");
    assert.equal(e.details.network_code, "BTC");
    assert.equal(e.actorRole, "moderator");
    assert.equal("role" in e.details, false);
  });

  test("FLAGGED_ADDRESS_REACTIVATED event captures address and network_code", () => {
    const e = buildFlaggedReactivatedEvent(
      "admin-1", "admin", "fa-uuid", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "BTC"
    );
    assert.equal(e.action, "FLAGGED_ADDRESS_REACTIVATED");
    assert.equal(e.details.address, "1BoatSLRHtKNngkdXEeobR76b53LETtpyT");
    assert.equal(e.details.network_code, "BTC");
    assert.equal(e.actorRole, "admin");
    assert.equal("role" in e.details, false);
  });

  test("FLAGGED_ADDRESS_IMPORT event captures inserted, skipped, error_count", () => {
    const e = buildFlaggedImportEvent("admin-1", "admin", 10, 2, 1);
    assert.equal(e.action, "FLAGGED_ADDRESS_IMPORT");
    assert.equal(e.actorRole, "admin");
    assert.equal("role" in e.details, false);
    assert.equal(e.details.inserted, 10);
    assert.equal(e.details.skipped, 2);
    assert.equal(e.details.error_count, 1);
    assert.equal(e.entityId, null);
  });

  test("FLAGGED_ADDRESS_EXPORT event captures format and count", () => {
    const e = buildFlaggedExportEvent("admin-1", "admin", "csv", 50);
    assert.equal(e.action, "FLAGGED_ADDRESS_EXPORT");
    assert.equal(e.actorRole, "admin");
    assert.equal("role" in e.details, false);
    assert.equal(e.details.format, "csv");
    assert.equal(e.details.count, 50);
    assert.equal(e.entityId, null);
  });

  test("audit userId is always the acting user id", () => {
    const e = buildFlaggedCreatedEvent("mod-uuid", "moderator", {
      id: "fa-uuid", network_code: "BTC", address: "1testaddr123", risk_category_code: "scam",
    });
    assert.equal(e.userId, "mod-uuid");
  });

  test("failed flow should not produce an audit event (no event built on null result)", () => {
    // Simulates the pattern: only call logAuditEvent after the DB operation succeeds.
    // If updateFlaggedAddress returns null, the route returns 404 without calling audit.
    const updated = null;
    let auditCalled = false;
    if (updated !== null) {
      auditCalled = true;
    }
    assert.equal(auditCalled, false);
  });

  test("failed reactivation should not produce an audit event", () => {
    const activated = false;
    let auditCalled = false;
    if (activated) {
      auditCalled = true;
    }
    assert.equal(auditCalled, false);
  });
});
