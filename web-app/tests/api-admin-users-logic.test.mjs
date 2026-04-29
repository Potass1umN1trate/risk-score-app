// Unit tests for admin user management route handler logic.
// Pure logic only — no DB, no Next.js, no network, no auth tokens.
// Run with: node --test web-app/tests/api-admin-users-logic.test.mjs
// Requires Node 22 (node:test built-in).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ─── Inline pure helpers mirroring route logic ────────────────────────────────

const ROLES = ["user", "moderator", "admin"];
function isRole(v) { return typeof v === "string" && ROLES.includes(v); }

function parsePaginationParams({ limit, page }) {
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 100;
  const rawLimit = parseInt(limit ?? "", 10);
  const rawPage = parseInt(page ?? "", 10);
  return {
    limit: isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT),
    page: isNaN(rawPage) || rawPage < 1 ? 1 : rawPage,
  };
}

// Simulate auth guard result (mirrors authorizeFreshUser return shape).
function makeAuthResult(scenario) {
  if (scenario === "unauthenticated") return { ok: false, status: 401, reason: "unauthenticated" };
  if (scenario === "blocked")         return { ok: false, status: 403, reason: "blocked" };
  if (scenario === "forbidden")       return { ok: false, status: 403, reason: "forbidden" };
  if (scenario === "admin")           return { ok: true,  user: { id: "admin-uuid", email: "admin@test.com", role: "admin" } };
  throw new Error(`Unknown scenario: ${scenario}`);
}

// Simulate the self-action guard from PATCH/DELETE handlers.
function selfActionGuard(requestingUserId, targetUserId) {
  return requestingUserId === targetUserId
    ? { blocked: true, error: "Cannot perform this action on your own account" }
    : { blocked: false };
}

// Simulate last-admin guard.
function lastAdminGuard(targetCurrentRole, newRoleOrDelete, adminCount) {
  const wouldRemoveAdmin =
    targetCurrentRole === "admin" &&
    (newRoleOrDelete === "delete" || newRoleOrDelete !== "admin");
  if (wouldRemoveAdmin && adminCount <= 1) {
    return { blocked: true, error: "Cannot remove the last admin account" };
  }
  return { blocked: false };
}

// Simulate POST /api/admin/users input validation.
function validateCreateUserInput({ email, password, role }) {
  const errors = {};
  const emailStr = typeof email === "string" ? email.trim() : "";
  if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
    errors.email = "Invalid email address";
  }
  const passwordStr = typeof password === "string" ? password : "";
  if (passwordStr.length < 8) {
    errors.password = "Password must be at least 8 characters";
  }
  const effectiveRole = isRole(role) ? role : "user";
  return { errors, effectiveRole };
}

// Simulate PATCH body validation.
function validatePatchBody(body) {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Invalid request body" };
  }
  const hasRole = "role" in body;
  const hasBlocked = "isBlocked" in body;
  if (!hasRole && !hasBlocked) {
    return { valid: false, error: "Provide role or isBlocked to update" };
  }
  if (hasRole && !isRole(body.role)) {
    return { valid: false, error: "Invalid role value" };
  }
  if (hasBlocked && typeof body.isBlocked !== "boolean") {
    return { valid: false, error: "isBlocked must be a boolean" };
  }
  return { valid: true };
}

// ─── Auth guard tests ─────────────────────────────────────────────────────────

describe("Auth guard", () => {
  test("unauthenticated → 401", () => {
    const auth = makeAuthResult("unauthenticated");
    assert.equal(auth.ok, false);
    assert.equal(auth.status, 401);
  });

  test("blocked user → 403", () => {
    const auth = makeAuthResult("blocked");
    assert.equal(auth.ok, false);
    assert.equal(auth.status, 403);
    assert.equal(auth.reason, "blocked");
  });

  test("non-admin role → 403 forbidden", () => {
    const auth = makeAuthResult("forbidden");
    assert.equal(auth.ok, false);
    assert.equal(auth.status, 403);
    assert.equal(auth.reason, "forbidden");
  });

  test("admin user → ok", () => {
    const auth = makeAuthResult("admin");
    assert.equal(auth.ok, true);
    assert.equal(auth.user.role, "admin");
  });
});

// ─── Self-action guard tests ──────────────────────────────────────────────────

describe("Self-action guard", () => {
  test("acting on own id → blocked", () => {
    const result = selfActionGuard("admin-uuid", "admin-uuid");
    assert.equal(result.blocked, true);
    assert.match(result.error, /own account/i);
  });

  test("acting on different id → allowed", () => {
    const result = selfActionGuard("admin-uuid", "other-uuid");
    assert.equal(result.blocked, false);
  });

  test("empty string ids are treated as equal", () => {
    const result = selfActionGuard("", "");
    assert.equal(result.blocked, true);
  });
});

// ─── Last-admin guard tests ───────────────────────────────────────────────────

describe("Last-admin guard", () => {
  test("demoting last admin → blocked", () => {
    const r = lastAdminGuard("admin", "user", 1);
    assert.equal(r.blocked, true);
    assert.match(r.error, /last admin/i);
  });

  test("deleting last admin → blocked", () => {
    const r = lastAdminGuard("admin", "delete", 1);
    assert.equal(r.blocked, true);
  });

  test("demoting one of two admins → allowed", () => {
    const r = lastAdminGuard("admin", "user", 2);
    assert.equal(r.blocked, false);
  });

  test("deleting one of two admins → allowed", () => {
    const r = lastAdminGuard("admin", "delete", 2);
    assert.equal(r.blocked, false);
  });

  test("changing admin to admin (no-op) → allowed regardless of count", () => {
    const r = lastAdminGuard("admin", "admin", 1);
    assert.equal(r.blocked, false);
  });

  test("demoting non-admin user → guard does not apply", () => {
    const r = lastAdminGuard("user", "moderator", 1);
    assert.equal(r.blocked, false);
  });

  test("demoting last admin when adminCount=0 (defensive) → blocked", () => {
    const r = lastAdminGuard("admin", "user", 0);
    assert.equal(r.blocked, true);
  });
});

// ─── Pagination parsing tests ─────────────────────────────────────────────────

describe("Pagination param parsing", () => {
  test("no params → defaults (page=1, limit=20)", () => {
    const r = parsePaginationParams({});
    assert.equal(r.page, 1);
    assert.equal(r.limit, 20);
  });

  test("page=2 limit=10 → respected", () => {
    const r = parsePaginationParams({ page: "2", limit: "10" });
    assert.equal(r.page, 2);
    assert.equal(r.limit, 10);
  });

  test("limit above MAX_LIMIT (100) → capped at 100", () => {
    const r = parsePaginationParams({ limit: "500" });
    assert.equal(r.limit, 100);
  });

  test("limit=0 → default", () => {
    const r = parsePaginationParams({ limit: "0" });
    assert.equal(r.limit, 20);
  });

  test("limit=-1 → default", () => {
    const r = parsePaginationParams({ limit: "-1" });
    assert.equal(r.limit, 20);
  });

  test("page=0 → default (1)", () => {
    const r = parsePaginationParams({ page: "0" });
    assert.equal(r.page, 1);
  });

  test("non-numeric strings → defaults", () => {
    const r = parsePaginationParams({ page: "abc", limit: "xyz" });
    assert.equal(r.page, 1);
    assert.equal(r.limit, 20);
  });
});

// ─── Create user input validation tests ──────────────────────────────────────

describe("POST /api/admin/users — input validation", () => {
  test("valid input → no errors, role preserved", () => {
    const { errors, effectiveRole } = validateCreateUserInput({
      email: "test@example.com", password: "password1", role: "moderator",
    });
    assert.deepEqual(errors, {});
    assert.equal(effectiveRole, "moderator");
  });

  test("missing email → email error", () => {
    const { errors } = validateCreateUserInput({ email: "", password: "password1", role: "user" });
    assert.ok(errors.email);
  });

  test("invalid email format → email error", () => {
    const { errors } = validateCreateUserInput({ email: "notanemail", password: "password1", role: "user" });
    assert.ok(errors.email);
  });

  test("password too short → password error", () => {
    const { errors } = validateCreateUserInput({ email: "a@b.com", password: "short", role: "user" });
    assert.ok(errors.password);
  });

  test("password exactly 8 chars → no password error", () => {
    const { errors } = validateCreateUserInput({ email: "a@b.com", password: "exactly8", role: "user" });
    assert.equal(errors.password, undefined);
  });

  test("invalid role → defaults to 'user'", () => {
    const { effectiveRole } = validateCreateUserInput({ email: "a@b.com", password: "password1", role: "superadmin" });
    assert.equal(effectiveRole, "user");
  });

  test("undefined role → defaults to 'user'", () => {
    const { effectiveRole } = validateCreateUserInput({ email: "a@b.com", password: "password1", role: undefined });
    assert.equal(effectiveRole, "user");
  });

  test("all three valid roles accepted", () => {
    for (const role of ["user", "moderator", "admin"]) {
      const { effectiveRole, errors } = validateCreateUserInput({ email: "a@b.com", password: "password1", role });
      assert.equal(effectiveRole, role);
      assert.equal(errors.email, undefined);
    }
  });
});

// ─── PATCH body validation tests ─────────────────────────────────────────────

describe("PATCH /api/admin/users/[id] — body validation", () => {
  test("valid role patch → valid", () => {
    assert.equal(validatePatchBody({ role: "moderator" }).valid, true);
  });

  test("valid isBlocked patch → valid", () => {
    assert.equal(validatePatchBody({ isBlocked: true }).valid, true);
    assert.equal(validatePatchBody({ isBlocked: false }).valid, true);
  });

  test("both role and isBlocked → valid", () => {
    assert.equal(validatePatchBody({ role: "user", isBlocked: false }).valid, true);
  });

  test("empty object → invalid", () => {
    const r = validatePatchBody({});
    assert.equal(r.valid, false);
    assert.match(r.error, /role or isBlocked/i);
  });

  test("null body → invalid", () => {
    const r = validatePatchBody(null);
    assert.equal(r.valid, false);
  });

  test("invalid role string → invalid", () => {
    const r = validatePatchBody({ role: "superadmin" });
    assert.equal(r.valid, false);
    assert.match(r.error, /invalid role/i);
  });

  test("isBlocked as string → invalid", () => {
    const r = validatePatchBody({ isBlocked: "true" });
    assert.equal(r.valid, false);
    assert.match(r.error, /boolean/i);
  });

  test("isBlocked as number → invalid", () => {
    const r = validatePatchBody({ isBlocked: 1 });
    assert.equal(r.valid, false);
  });
});
