// Unit tests for admin network-management route logic.
// Run: node --test web-app/tests/api-admin-networks-logic.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

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

function validatePatchBody(body) {
  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.is_active !== "boolean"
  ) {
    return { status: 400, body: { error: "is_active must be a boolean" } };
  }
  return null;
}

function patchNetworkOutcome(updated, code, isActive) {
  if (!updated) return { status: 404, body: { error: "Network not found" } };
  return { status: 200, body: { code: code.trim().toUpperCase(), is_active: isActive } };
}

function analyzeNetworkGuardOutcome(network, isActiveResult) {
  if (typeof network !== "string" || !network.trim()) {
    return {
      status: 422,
      body: { error_code: "INVALID_REQUEST", detail: "network is required", request_id: null },
    };
  }
  if (!isActiveResult) {
    return {
      status: 400,
      body: { error_code: "UNSUPPORTED_NETWORK", detail: "This network is not supported.", request_id: null },
    };
  }
  return null;
}

test("admin networks auth guard: unauthenticated -> 401", () => {
  const r = authzResponse({ ok: false, status: 401, reason: "unauthenticated" });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "Authentication required");
});

test("admin networks auth guard: user role -> 403", () => {
  const r = authzResponse({ ok: false, status: 403, reason: "forbidden" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "Forbidden");
});

test("admin networks auth guard: auth DB unavailable -> 500", () => {
  const r = authzResponse({ ok: false, status: 500, reason: "auth_unavailable" });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /unavailable/i);
});

test("admin networks auth guard: admin -> continue", () => {
  assert.equal(authzResponse({ ok: true, user: { id: "admin-1", role: "admin" } }), null);
});

test("PATCH validation: missing is_active -> 400", () => {
  const r = validatePatchBody({});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /is_active/);
});

test("PATCH validation: is_active must be boolean", () => {
  assert.equal(validatePatchBody({ is_active: "false" }).status, 400);
  assert.equal(validatePatchBody({ is_active: 1 }).status, 400);
  assert.equal(validatePatchBody({ is_active: null }).status, 400);
});

test("PATCH validation: boolean false is accepted", () => {
  assert.equal(validatePatchBody({ is_active: false }), null);
});

test("PATCH validation: boolean true is accepted", () => {
  assert.equal(validatePatchBody({ is_active: true }), null);
});

test("PATCH route: unknown network code -> 404", () => {
  const r = patchNetworkOutcome(false, "NOPE", true);
  assert.equal(r.status, 404);
  assert.match(r.body.error, /not found/i);
});

test("PATCH route: known network returns normalized code and status", () => {
  const r = patchNetworkOutcome(true, "btc", false);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { code: "BTC", is_active: false });
});

test("analyze guard: missing network -> structured INVALID_REQUEST", () => {
  const r = analyzeNetworkGuardOutcome(undefined, false);
  assert.equal(r.status, 422);
  assert.equal(r.body.error_code, "INVALID_REQUEST");
  assert.equal(r.body.request_id, null);
});

test("analyze guard: inactive or unknown network -> structured UNSUPPORTED_NETWORK", () => {
  const r = analyzeNetworkGuardOutcome("BTC", false);
  assert.equal(r.status, 400);
  assert.equal(r.body.error_code, "UNSUPPORTED_NETWORK");
  assert.equal(r.body.request_id, null);
});

test("analyze guard: active network -> continue", () => {
  assert.equal(analyzeNetworkGuardOutcome("BTC", true), null);
});
