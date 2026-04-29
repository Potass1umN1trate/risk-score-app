// Unit tests for admin network-management route logic.
// Run: node --test web-app/tests/api-admin-networks-logic.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

const ANALYTICS_LIMIT_CAPS = {
  max_depth: 5,
  max_tx_limit: 200,
  max_period_days: 3650,
};

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
  const limitFields = [
    "default_depth",
    "max_depth",
    "default_tx_limit",
    "max_tx_limit",
    "default_period_days",
    "max_period_days",
  ];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: 400, body: { error: "Request body must be an object" } };
  }

  const allowed = new Set(["is_active", ...limitFields]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return { status: 400, body: { error: `Unknown field: ${key}` } };
  }

  if (Object.keys(body).length === 0) {
    return { status: 400, body: { error: "At least one field is required" } };
  }

  if ("is_active" in body && typeof body.is_active !== "boolean") {
    return { status: 400, body: { error: "is_active must be a boolean" } };
  }

  for (const field of limitFields) {
    if (!(field in body)) continue;
    if (field === "default_period_days" && body[field] === null) continue;
    if (!Number.isInteger(body[field])) {
      return { status: 400, body: { error: `${field} must be an integer` } };
    }
  }

  const merged = {
    default_depth: 2,
    max_depth: 5,
    default_tx_limit: 10,
    max_tx_limit: 200,
    default_period_days: null,
    max_period_days: 3650,
    ...body,
  };

  if (merged.default_depth < 1) return { status: 400, body: { error: "default_depth" } };
  if (merged.max_depth > ANALYTICS_LIMIT_CAPS.max_depth) {
    return { status: 400, body: { error: "max_depth" } };
  }
  if (merged.max_depth < merged.default_depth) {
    return { status: 400, body: { error: "max_depth" } };
  }
  if (merged.default_tx_limit < 1) return { status: 400, body: { error: "default_tx_limit" } };
  if (merged.max_tx_limit > ANALYTICS_LIMIT_CAPS.max_tx_limit) {
    return { status: 400, body: { error: "max_tx_limit" } };
  }
  if (merged.max_tx_limit < merged.default_tx_limit) {
    return { status: 400, body: { error: "max_tx_limit" } };
  }
  if (merged.default_period_days !== null && merged.default_period_days < 1) {
    return { status: 400, body: { error: "default_period_days" } };
  }
  if (merged.max_period_days < 1) return { status: 400, body: { error: "max_period_days" } };
  if (merged.max_period_days > ANALYTICS_LIMIT_CAPS.max_period_days) {
    return { status: 400, body: { error: "max_period_days" } };
  }
  if (
    merged.default_period_days !== null &&
    merged.default_period_days > merged.max_period_days
  ) {
    return { status: 400, body: { error: "default_period_days" } };
  }

  return null;
}

function patchNetworkOutcome(updated, code, patch) {
  if (!updated) return { status: 404, body: { error: "Network not found" } };
  return {
    status: 200,
    body: {
      code: code.trim().toUpperCase(),
      is_active: true,
      default_depth: 2,
      max_depth: 5,
      default_tx_limit: 10,
      max_tx_limit: 200,
      default_period_days: null,
      max_period_days: 3650,
      ...patch,
    },
  };
}

function analyzeNetworkGuardOutcome(body, config) {
  const network = body?.network;
  if (typeof network !== "string" || !network.trim()) {
    return {
      status: 422,
      body: { error_code: "INVALID_REQUEST", detail: "network is required", request_id: null },
    };
  }
  if (!config?.is_active) {
    return {
      status: 400,
      body: { error_code: "UNSUPPORTED_NETWORK", detail: "This network is not supported.", request_id: null },
    };
  }
  const maxDepth = Math.min(config.max_depth, ANALYTICS_LIMIT_CAPS.max_depth);
  const maxTxLimit = Math.min(config.max_tx_limit, ANALYTICS_LIMIT_CAPS.max_tx_limit);
  const maxPeriodDays = Math.min(config.max_period_days, ANALYTICS_LIMIT_CAPS.max_period_days);
  const depth = body.depth ?? config.default_depth;
  if (!Number.isInteger(depth) || depth < 1 || depth > maxDepth) {
    return {
      status: 422,
      body: { error_code: "INVALID_REQUEST", detail: "depth out of range", request_id: null },
    };
  }
  const txLimit = body.tx_limit ?? config.default_tx_limit;
  if (!Number.isInteger(txLimit) || txLimit < 1 || txLimit > maxTxLimit) {
    return {
      status: 422,
      body: { error_code: "INVALID_REQUEST", detail: "tx_limit out of range", request_id: null },
    };
  }
  const periodDays = body.period_days === undefined ? config.default_period_days : body.period_days;
  if (
    periodDays !== null &&
    (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > maxPeriodDays)
  ) {
    return {
      status: 422,
      body: { error_code: "INVALID_REQUEST", detail: "period_days out of range", request_id: null },
    };
  }
  return null;
}

const activeConfig = {
  is_active: true,
  default_depth: 2,
  max_depth: 5,
  default_tx_limit: 10,
  max_tx_limit: 200,
  default_period_days: null,
  max_period_days: 3650,
};

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

test("GET networks: response includes analysis limits", () => {
  const body = patchNetworkOutcome(true, "btc", {}).body;
  assert.equal(typeof body.default_depth, "number");
  assert.equal(typeof body.max_depth, "number");
  assert.equal(typeof body.default_tx_limit, "number");
  assert.equal(typeof body.max_tx_limit, "number");
  assert.equal(body.default_period_days, null);
  assert.equal(typeof body.max_period_days, "number");
});

test("PATCH validation: empty body -> 400", () => {
  const r = validatePatchBody({});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /field/);
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

test("PATCH validation: accepts limit-only patch", () => {
  assert.equal(validatePatchBody({ default_depth: 3, max_depth: 5 }), null);
});

test("PATCH validation: limit fields must be integers", () => {
  assert.equal(validatePatchBody({ max_depth: 1.5 }).status, 400);
  assert.equal(validatePatchBody({ max_tx_limit: "200" }).status, 400);
  assert.equal(validatePatchBody({ default_period_days: null }), null);
});

test("PATCH validation: rejects defaults above max", () => {
  assert.equal(validatePatchBody({ default_depth: 6, max_depth: 5 }).status, 400);
  assert.equal(validatePatchBody({ default_tx_limit: 201, max_tx_limit: 200 }).status, 400);
  assert.equal(validatePatchBody({ default_period_days: 366, max_period_days: 365 }).status, 400);
});

test("PATCH validation: rejects max values above analytics-service caps", () => {
  assert.equal(validatePatchBody({ max_depth: 6 }).status, 400);
  assert.equal(validatePatchBody({ max_tx_limit: 201 }).status, 400);
  assert.equal(validatePatchBody({ max_period_days: 3651 }).status, 400);
});

test("PATCH validation: rejects values below minimum", () => {
  assert.equal(validatePatchBody({ default_depth: 0 }).status, 400);
  assert.equal(validatePatchBody({ default_tx_limit: 0 }).status, 400);
  assert.equal(validatePatchBody({ default_period_days: 0 }).status, 400);
  assert.equal(validatePatchBody({ max_period_days: 0 }).status, 400);
});

test("PATCH route: unknown network code -> 404", () => {
  const r = patchNetworkOutcome(false, "NOPE", { is_active: true });
  assert.equal(r.status, 404);
  assert.match(r.body.error, /not found/i);
});

test("PATCH route: known network returns normalized code and updated config", () => {
  const r = patchNetworkOutcome(true, "btc", { is_active: false, max_depth: 4 });
  assert.equal(r.status, 200);
  assert.equal(r.body.code, "BTC");
  assert.equal(r.body.is_active, false);
  assert.equal(r.body.max_depth, 4);
});

test("analyze guard: missing network -> structured INVALID_REQUEST", () => {
  const r = analyzeNetworkGuardOutcome({}, activeConfig);
  assert.equal(r.status, 422);
  assert.equal(r.body.error_code, "INVALID_REQUEST");
  assert.equal(r.body.request_id, null);
});

test("analyze guard: inactive or unknown network -> structured UNSUPPORTED_NETWORK", () => {
  const r = analyzeNetworkGuardOutcome({ network: "BTC" }, null);
  assert.equal(r.status, 400);
  assert.equal(r.body.error_code, "UNSUPPORTED_NETWORK");
  assert.equal(r.body.request_id, null);
});

test("analyze guard: depth above network max -> structured INVALID_REQUEST", () => {
  const r = analyzeNetworkGuardOutcome({ network: "BTC", depth: 6, tx_limit: 10 }, activeConfig);
  assert.equal(r.status, 422);
  assert.equal(r.body.error_code, "INVALID_REQUEST");
  assert.equal(r.body.request_id, null);
});

test("analyze guard: tx_limit above network max -> structured INVALID_REQUEST", () => {
  const r = analyzeNetworkGuardOutcome({ network: "BTC", depth: 5, tx_limit: 201 }, activeConfig);
  assert.equal(r.status, 422);
  assert.equal(r.body.error_code, "INVALID_REQUEST");
});

test("analyze guard: period_days above network max -> structured INVALID_REQUEST", () => {
  const r = analyzeNetworkGuardOutcome(
    { network: "BTC", depth: 5, tx_limit: 200, period_days: 3651 },
    activeConfig
  );
  assert.equal(r.status, 422);
  assert.equal(r.body.error_code, "INVALID_REQUEST");
});

test("analyze guard: active network -> continue", () => {
  assert.equal(
    analyzeNetworkGuardOutcome(
      { network: "BTC", depth: 5, tx_limit: 200, period_days: 3650 },
      activeConfig
    ),
    null
  );
});

test("analyze guard: effective max is capped to analytics-service contract", () => {
  const oversizedConfig = {
    ...activeConfig,
    max_depth: 6,
    max_tx_limit: 250,
    max_period_days: 4000,
  };

  assert.equal(
    analyzeNetworkGuardOutcome(
      { network: "BTC", depth: 5, tx_limit: 200, period_days: 3650 },
      oversizedConfig
    ),
    null
  );
  assert.equal(
    analyzeNetworkGuardOutcome(
      { network: "BTC", depth: 6, tx_limit: 200, period_days: 3650 },
      oversizedConfig
    ).status,
    422
  );
  assert.equal(
    analyzeNetworkGuardOutcome(
      { network: "BTC", depth: 5, tx_limit: 201, period_days: 3650 },
      oversizedConfig
    ).status,
    422
  );
  assert.equal(
    analyzeNetworkGuardOutcome(
      { network: "BTC", depth: 5, tx_limit: 200, period_days: 3651 },
      oversizedConfig
    ).status,
    422
  );
});
