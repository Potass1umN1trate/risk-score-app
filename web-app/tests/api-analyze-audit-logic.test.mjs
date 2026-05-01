// Unit tests for RUN_ANALYSIS audit event logic in POST /api/analyze.
// Pure logic only — no DB, no Next.js, no network, no auth tokens.
// Run with: node --test web-app/tests/api-analyze-audit-logic.test.mjs
// Requires Node 22 (node:test built-in).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ─── Inline helpers mirroring route logic ────────────────────────────────────

// Mirrors the condition in /api/analyze/route.ts that gates the audit write:
// upstream.ok && typeof data?.request_id === "string" && authz.user?.id
function shouldLogAudit(upstreamOk, data, userId) {
  return upstreamOk && typeof data?.request_id === "string" && Boolean(userId);
}

// Mirrors the audit event shape built in /api/analyze/route.ts on success.
function buildRunAnalysisEvent(userId, role, requestBody, upstreamBody, data) {
  return {
    userId,
    action: "RUN_ANALYSIS",
    actorRole: role,
    entity: "analysis",
    entityId: data.request_id,
    details: {
      address: requestBody.address,
      network: upstreamBody.network,
      risk_level: data.risk_level ?? null,
      request_id: data.request_id,
      result_id: data.result_id ?? null,
    },
  };
}

const sampleUser = { id: "user-uuid-1", email: "alice@example.com", role: "user" };
const sampleRequestBody = { address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", network: "btc", depth: 2, tx_limit: 50 };
const sampleUpstreamBody = { network: "BTC", depth: 2, tx_limit: 50 };
const sampleSuccessData = {
  request_id: "req-uuid-1",
  result_id: "res-uuid-1",
  risk_level: "MEDIUM",
  risk_score: 42.5,
};

// ─── shouldLogAudit gate tests ────────────────────────────────────────────────

describe("shouldLogAudit gate", () => {
  test("upstream ok + valid request_id + userId → should log", () => {
    assert.equal(shouldLogAudit(true, sampleSuccessData, sampleUser.id), true);
  });

  test("upstream not ok (4xx/5xx) → should NOT log", () => {
    assert.equal(shouldLogAudit(false, sampleSuccessData, sampleUser.id), false);
  });

  test("upstream ok but request_id missing → should NOT log", () => {
    assert.equal(shouldLogAudit(true, { risk_level: "LOW" }, sampleUser.id), false);
  });

  test("upstream ok but request_id is not a string → should NOT log", () => {
    assert.equal(shouldLogAudit(true, { request_id: 12345 }, sampleUser.id), false);
  });

  test("upstream ok but userId is falsy → should NOT log", () => {
    assert.equal(shouldLogAudit(true, sampleSuccessData, null), false);
    assert.equal(shouldLogAudit(true, sampleSuccessData, ""), false);
    assert.equal(shouldLogAudit(true, sampleSuccessData, undefined), false);
  });

  test("upstream ok + null data → should NOT log", () => {
    assert.equal(shouldLogAudit(true, null, sampleUser.id), false);
  });
});

// ─── RUN_ANALYSIS event shape tests ──────────────────────────────────────────

describe("RUN_ANALYSIS audit event shape", () => {
  test("event has correct action and entity", () => {
    const e = buildRunAnalysisEvent(sampleUser.id, sampleUser.role, sampleRequestBody, sampleUpstreamBody, sampleSuccessData);
    assert.equal(e.action, "RUN_ANALYSIS");
    assert.equal(e.entity, "analysis");
    assert.equal(e.entityId, "req-uuid-1");
  });

  test("event userId is the authenticated user id", () => {
    const e = buildRunAnalysisEvent(sampleUser.id, sampleUser.role, sampleRequestBody, sampleUpstreamBody, sampleSuccessData);
    assert.equal(e.userId, sampleUser.id);
  });

  test("event includes actorRole snapshot", () => {
    const e = buildRunAnalysisEvent(sampleUser.id, "moderator", sampleRequestBody, sampleUpstreamBody, sampleSuccessData);
    assert.equal(e.actorRole, "moderator");
    assert.equal("role" in e.details, false);
  });

  test("event details contain address from request body and network from upstream body", () => {
    const e = buildRunAnalysisEvent(sampleUser.id, sampleUser.role, sampleRequestBody, sampleUpstreamBody, sampleSuccessData);
    assert.equal(e.details.address, "1BoatSLRHtKNngkdXEeobR76b53LETtpyT");
    assert.equal(e.details.network, "BTC");
  });

  test("event details contain risk_level from upstream response", () => {
    const e = buildRunAnalysisEvent(sampleUser.id, sampleUser.role, sampleRequestBody, sampleUpstreamBody, sampleSuccessData);
    assert.equal(e.details.risk_level, "MEDIUM");
  });

  test("event details contain request_id and result_id", () => {
    const e = buildRunAnalysisEvent(sampleUser.id, sampleUser.role, sampleRequestBody, sampleUpstreamBody, sampleSuccessData);
    assert.equal(e.details.request_id, "req-uuid-1");
    assert.equal(e.details.result_id, "res-uuid-1");
  });

  test("missing risk_level in upstream data falls back to null", () => {
    const dataNoLevel = { request_id: "req-2", result_id: "res-2" };
    const e = buildRunAnalysisEvent(sampleUser.id, sampleUser.role, sampleRequestBody, sampleUpstreamBody, dataNoLevel);
    assert.equal(e.details.risk_level, null);
  });

  test("missing result_id in upstream data falls back to null", () => {
    const dataNoResult = { request_id: "req-3", risk_level: "LOW" };
    const e = buildRunAnalysisEvent(sampleUser.id, sampleUser.role, sampleRequestBody, sampleUpstreamBody, dataNoResult);
    assert.equal(e.details.result_id, null);
  });

  test("details do not contain sensitive fields", () => {
    const e = buildRunAnalysisEvent(sampleUser.id, sampleUser.role, sampleRequestBody, sampleUpstreamBody, sampleSuccessData);
    assert.equal("password" in e.details, false);
    assert.equal("password_hash" in e.details, false);
    assert.equal("token" in e.details, false);
    assert.equal("secret" in e.details, false);
  });

  test("all three roles emit the same event action", () => {
    for (const role of ["user", "moderator", "admin"]) {
      const e = buildRunAnalysisEvent(sampleUser.id, role, sampleRequestBody, sampleUpstreamBody, sampleSuccessData);
      assert.equal(e.action, "RUN_ANALYSIS");
      assert.equal(e.actorRole, role);
      assert.equal("role" in e.details, false);
    }
  });
});

// ─── Failed-flow does not audit ───────────────────────────────────────────────

describe("Failed upstream analysis does not produce audit event", () => {
  test("upstream 400 (INVALID_ADDRESS) → no audit", () => {
    const errorData = { error_code: "INVALID_ADDRESS", detail: "bad address", request_id: null };
    assert.equal(shouldLogAudit(false, errorData, sampleUser.id), false);
  });

  test("upstream 429 (BLOCKCHAIN_RATE_LIMITED) → no audit", () => {
    const errorData = { error_code: "BLOCKCHAIN_RATE_LIMITED", detail: "rate limited", request_id: "req-x" };
    assert.equal(shouldLogAudit(false, errorData, sampleUser.id), false);
  });

  test("upstream 500 (INTERNAL_ERROR) → no audit", () => {
    const errorData = { error_code: "INTERNAL_ERROR", detail: "internal error", request_id: "req-y" };
    assert.equal(shouldLogAudit(false, errorData, sampleUser.id), false);
  });

  test("network error (fetch threw) → no audit (upstream.ok would be false)", () => {
    assert.equal(shouldLogAudit(false, null, sampleUser.id), false);
  });
});

// ─── USER_REGISTERED event shape ─────────────────────────────────────────────

describe("USER_REGISTERED audit event shape", () => {
  function buildUserRegisteredEvent(newUserId, email) {
    return {
      userId: newUserId,
      action: "USER_REGISTERED",
      actorRole: "user",
      entity: "user",
      entityId: newUserId,
      details: { email },
    };
  }

  test("event has correct action and entity", () => {
    const e = buildUserRegisteredEvent("new-uuid", "alice@example.com");
    assert.equal(e.action, "USER_REGISTERED");
    assert.equal(e.entity, "user");
    assert.equal(e.entityId, "new-uuid");
  });

  test("userId is the newly created user id (self-logging)", () => {
    const e = buildUserRegisteredEvent("new-uuid", "alice@example.com");
    assert.equal(e.userId, "new-uuid");
    assert.equal(e.entityId, "new-uuid");
  });

  test("role is always 'user' for registration", () => {
    const e = buildUserRegisteredEvent("new-uuid", "alice@example.com");
    assert.equal(e.actorRole, "user");
    assert.equal("role" in e.details, false);
  });

  test("details contain email but not password", () => {
    const e = buildUserRegisteredEvent("new-uuid", "alice@example.com");
    assert.equal(e.details.email, "alice@example.com");
    assert.equal("password" in e.details, false);
    assert.equal("password_hash" in e.details, false);
    assert.equal("token" in e.details, false);
  });
});
