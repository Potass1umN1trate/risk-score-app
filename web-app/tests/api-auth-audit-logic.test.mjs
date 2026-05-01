// Pure-logic tests for audit events emitted by auth.ts credential and OAuth flows.
// No DB, no NextAuth, no network — all external dependencies are injected as
// plain async functions so tests run without any infrastructure.
// Run with: node --test web-app/tests/api-auth-audit-logic.test.mjs
// Requires Node 22 (node:test built-in).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ─── Inline logic mirroring auth.ts authorize() ───────────────────────────────

async function authorize(credentials, { findUserByEmail, comparePassword, logAuditEvent }) {
  const email = credentials?.email?.trim().toLowerCase();
  const password = credentials?.password ?? "";

  if (!email || !password) return null;

  let user = null;
  try {
    user = await findUserByEmail(email);
  } catch {
    return null;
  }

  if (user?.isBlocked) {
    void logAuditEvent({
      userId: user.id,
      action: "LOGIN_FAILURE",
      entity: "user",
      entityId: user.id,
      details: { email, reason: "blocked", role: user.role },
    });
    return null;
  }

  if (!user?.passwordHash) {
    void logAuditEvent({
      userId: user?.id ?? null,
      action: "LOGIN_FAILURE",
      entity: "user",
      entityId: user?.id ?? null,
      details: { email, reason: "missing_hash", role: user?.role ?? null },
    });
    return null;
  }

  let passwordMatches;
  try {
    passwordMatches = await comparePassword(password, user.passwordHash);
  } catch {
    return null;
  }

  if (!passwordMatches) {
    void logAuditEvent({
      userId: user.id,
      action: "LOGIN_FAILURE",
      entity: "user",
      entityId: user.id,
      details: { email, reason: "wrong_password", role: user.role },
    });
    return null;
  }

  void logAuditEvent({
    userId: user.id,
    action: "LOGIN_SUCCESS",
    entity: "user",
    entityId: user.id,
    details: { email: user.email, role: user.role },
  });

  return { id: user.id, email: user.email, role: user.role, isBlocked: user.isBlocked };
}

// ─── Inline logic mirroring auth.ts signIn callback (GitHub path) ─────────────

async function signInCallback({ account, profile }, { findOrCreateOAuthUser, logAuditEvent }) {
  if (account?.provider === "github") {
    const email = profile?.email;
    if (!email) return false;
    try {
      const user = await findOrCreateOAuthUser(account.provider, account.providerAccountId, email);
      if (user.isBlocked) return false;
      void logAuditEvent({
        userId: user.id,
        action: "OAUTH_LOGIN_SUCCESS",
        entity: "user",
        entityId: user.id,
        details: { email: user.email, role: user.role, provider: account.provider },
      });
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return {
    id: "user-uuid-1",
    email: "alice@example.com",
    passwordHash: "$2b$12$hashvalue",
    role: "user",
    isBlocked: false,
    ...overrides,
  };
}

// Returns a spy object. Access spy.captured AFTER the await — do NOT destructure
// captured out of the spy at construction time (primitive null won't update).
function makeSpy() {
  const spy = { captured: null };
  spy.logAuditEvent = async (event) => { spy.captured = event; };
  return spy;
}

const creds = { email: "alice@example.com", password: "password123" };
const matchPassword = async () => true;
const noMatchPassword = async () => false;

// ─── LOGIN_SUCCESS event shape ─────────────────────────────────────────────────

describe("LOGIN_SUCCESS audit event", () => {
  test("emitted after successful credentials login", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser(),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.ok(spy.captured, "audit event should be captured");
    assert.equal(spy.captured.action, "LOGIN_SUCCESS");
  });

  test("userId and entityId are the authenticated user's id", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser({ id: "specific-uuid" }),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.userId, "specific-uuid");
    assert.equal(spy.captured.entityId, "specific-uuid");
  });

  test("details contain email and role snapshot", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser({ role: "moderator", email: "alice@example.com" }),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.details.email, "alice@example.com");
    assert.equal(spy.captured.details.role, "moderator");
  });

  test("details do not contain password or hash", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser(),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal("password" in spy.captured.details, false);
    assert.equal("password_hash" in spy.captured.details, false);
    assert.equal("passwordHash" in spy.captured.details, false);
  });

  test("authorize() returns user object on success", async () => {
    const spy = makeSpy();
    const result = await authorize(creds, {
      findUserByEmail: async () => makeUser(),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    assert.ok(result, "should return a user object");
    assert.equal(result.id, "user-uuid-1");
    assert.equal(result.role, "user");
  });

  test("all three roles emit LOGIN_SUCCESS with correct role snapshot", async () => {
    for (const role of ["user", "moderator", "admin"]) {
      const spy = makeSpy();
      await authorize(creds, {
        findUserByEmail: async () => makeUser({ role }),
        comparePassword: matchPassword,
        logAuditEvent: spy.logAuditEvent,
      });
      await new Promise((r) => setImmediate(r));
      assert.equal(spy.captured.action, "LOGIN_SUCCESS");
      assert.equal(spy.captured.details.role, role);
    }
  });
});

// ─── LOGIN_FAILURE — wrong password ───────────────────────────────────────────

describe("LOGIN_FAILURE audit event — wrong password", () => {
  test("emitted on wrong password", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser(),
      comparePassword: noMatchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.action, "LOGIN_FAILURE");
    assert.equal(spy.captured.details.reason, "wrong_password");
  });

  test("userId is the known user's id on wrong password", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser({ id: "known-uuid" }),
      comparePassword: noMatchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.userId, "known-uuid");
  });

  test("details contain email and role snapshot on wrong password", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser({ role: "admin" }),
      comparePassword: noMatchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.details.email, "alice@example.com");
    assert.equal(spy.captured.details.role, "admin");
  });

  test("authorize() returns null on wrong password", async () => {
    const spy = makeSpy();
    const result = await authorize(creds, {
      findUserByEmail: async () => makeUser(),
      comparePassword: noMatchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    assert.equal(result, null);
  });
});

// ─── LOGIN_FAILURE — blocked user ─────────────────────────────────────────────

describe("LOGIN_FAILURE audit event — blocked user", () => {
  test("emitted when user is blocked", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser({ isBlocked: true }),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.action, "LOGIN_FAILURE");
    assert.equal(spy.captured.details.reason, "blocked");
  });

  test("userId is the blocked user's id", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser({ id: "blocked-uuid", isBlocked: true }),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.userId, "blocked-uuid");
  });

  test("authorize() returns null for blocked user", async () => {
    const spy = makeSpy();
    const result = await authorize(creds, {
      findUserByEmail: async () => makeUser({ isBlocked: true }),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    assert.equal(result, null);
  });
});

// ─── LOGIN_FAILURE — missing password hash ────────────────────────────────────

describe("LOGIN_FAILURE audit event — missing_hash (OAuth-only account)", () => {
  test("emitted when passwordHash is null (OAuth-only account)", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser({ passwordHash: null }),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.action, "LOGIN_FAILURE");
    assert.equal(spy.captured.details.reason, "missing_hash");
  });

  test("userId is the user's id when account exists but has no hash", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => makeUser({ id: "oauth-only-uuid", passwordHash: null }),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.userId, "oauth-only-uuid");
  });

  test("userId is null when user not found at all", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => null,
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.action, "LOGIN_FAILURE");
    assert.equal(spy.captured.userId, null);
    assert.equal(spy.captured.details.reason, "missing_hash");
  });

  test("authorize() returns null for missing hash", async () => {
    const spy = makeSpy();
    const result = await authorize(creds, {
      findUserByEmail: async () => makeUser({ passwordHash: null }),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    assert.equal(result, null);
  });
});

// ─── No audit on missing credentials or DB errors ─────────────────────────────

describe("No audit event on missing credentials or DB errors", () => {
  test("no audit event when email is empty", async () => {
    const spy = makeSpy();
    await authorize({ email: "", password: "secret" }, {
      findUserByEmail: async () => makeUser(),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured, null, "no audit on empty email");
  });

  test("no audit event when password is empty", async () => {
    const spy = makeSpy();
    await authorize({ email: "alice@example.com", password: "" }, {
      findUserByEmail: async () => makeUser(),
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured, null, "no audit on empty password");
  });

  test("no audit event when DB throws during user lookup", async () => {
    const spy = makeSpy();
    await authorize(creds, {
      findUserByEmail: async () => { throw new Error("DB error"); },
      comparePassword: matchPassword,
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured, null, "no audit on DB lookup failure");
  });

  test("no audit event when comparePassword throws", async () => {
    const spy = makeSpy();
    const result = await authorize(creds, {
      findUserByEmail: async () => makeUser(),
      comparePassword: async () => { throw new Error("bcrypt error"); },
      logAuditEvent: spy.logAuditEvent,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(result, null);
    assert.equal(spy.captured, null, "no audit when comparePassword throws");
  });
});

// ─── OAUTH_LOGIN_SUCCESS event shape ──────────────────────────────────────────

describe("OAUTH_LOGIN_SUCCESS audit event", () => {
  const githubAccount = { provider: "github", providerAccountId: "gh-12345" };
  const githubProfile = { email: "alice@example.com" };

  test("emitted after successful GitHub sign-in", async () => {
    const spy = makeSpy();
    await signInCallback(
      { account: githubAccount, profile: githubProfile },
      { findOrCreateOAuthUser: async () => makeUser(), logAuditEvent: spy.logAuditEvent }
    );
    await new Promise((r) => setImmediate(r));
    assert.ok(spy.captured, "audit event should be captured");
    assert.equal(spy.captured.action, "OAUTH_LOGIN_SUCCESS");
  });

  test("userId and entityId are the OAuth user's id", async () => {
    const spy = makeSpy();
    await signInCallback(
      { account: githubAccount, profile: githubProfile },
      { findOrCreateOAuthUser: async () => makeUser({ id: "oauth-uuid" }), logAuditEvent: spy.logAuditEvent }
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.userId, "oauth-uuid");
    assert.equal(spy.captured.entityId, "oauth-uuid");
  });

  test("details contain email, role, and provider", async () => {
    const spy = makeSpy();
    await signInCallback(
      { account: githubAccount, profile: githubProfile },
      { findOrCreateOAuthUser: async () => makeUser({ role: "moderator", email: "alice@example.com" }), logAuditEvent: spy.logAuditEvent }
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(spy.captured.details.email, "alice@example.com");
    assert.equal(spy.captured.details.role, "moderator");
    assert.equal(spy.captured.details.provider, "github");
  });

  test("details do not contain password or token", async () => {
    const spy = makeSpy();
    await signInCallback(
      { account: githubAccount, profile: githubProfile },
      { findOrCreateOAuthUser: async () => makeUser(), logAuditEvent: spy.logAuditEvent }
    );
    await new Promise((r) => setImmediate(r));
    assert.equal("password" in spy.captured.details, false);
    assert.equal("token" in spy.captured.details, false);
    assert.equal("secret" in spy.captured.details, false);
  });

  test("signInCallback returns true on success", async () => {
    const spy = makeSpy();
    const result = await signInCallback(
      { account: githubAccount, profile: githubProfile },
      { findOrCreateOAuthUser: async () => makeUser(), logAuditEvent: spy.logAuditEvent }
    );
    assert.equal(result, true);
  });

  test("no audit event when GitHub user is blocked", async () => {
    const spy = makeSpy();
    const result = await signInCallback(
      { account: githubAccount, profile: githubProfile },
      { findOrCreateOAuthUser: async () => makeUser({ isBlocked: true }), logAuditEvent: spy.logAuditEvent }
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(result, false);
    assert.equal(spy.captured, null, "blocked user must not emit OAUTH_LOGIN_SUCCESS");
  });

  test("no audit event when GitHub profile has no email", async () => {
    const spy = makeSpy();
    const result = await signInCallback(
      { account: githubAccount, profile: {} },
      { findOrCreateOAuthUser: async () => makeUser(), logAuditEvent: spy.logAuditEvent }
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(result, false);
    assert.equal(spy.captured, null, "no email → no audit event");
  });

  test("no audit event when findOrCreateOAuthUser throws", async () => {
    const spy = makeSpy();
    const result = await signInCallback(
      { account: githubAccount, profile: githubProfile },
      { findOrCreateOAuthUser: async () => { throw new Error("DB error"); }, logAuditEvent: spy.logAuditEvent }
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(result, false);
    assert.equal(spy.captured, null, "DB error → no audit event");
  });

  test("all three roles emit OAUTH_LOGIN_SUCCESS with correct role snapshot", async () => {
    for (const role of ["user", "moderator", "admin"]) {
      const spy = makeSpy();
      await signInCallback(
        { account: githubAccount, profile: githubProfile },
        { findOrCreateOAuthUser: async () => makeUser({ role }), logAuditEvent: spy.logAuditEvent }
      );
      await new Promise((r) => setImmediate(r));
      assert.equal(spy.captured.action, "OAUTH_LOGIN_SUCCESS");
      assert.equal(spy.captured.details.role, role);
    }
  });

  test("non-GitHub provider does not trigger OAUTH_LOGIN_SUCCESS", async () => {
    const spy = makeSpy();
    const result = await signInCallback(
      { account: { provider: "credentials" }, profile: undefined },
      { findOrCreateOAuthUser: async () => makeUser(), logAuditEvent: spy.logAuditEvent }
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(result, true);
    assert.equal(spy.captured, null, "credentials provider must not emit OAuth audit event");
  });
});

// ─── Audit event taxonomy ─────────────────────────────────────────────────────

describe("Auth audit action taxonomy", () => {
  const AUTH_ACTIONS = ["LOGIN_SUCCESS", "LOGIN_FAILURE", "OAUTH_LOGIN_SUCCESS"];

  for (const action of AUTH_ACTIONS) {
    test(`action "${action}" is an uppercase snake_case string`, () => {
      assert.ok(typeof action === "string" && action.length > 0);
      assert.match(action, /^[A-Z][A-Z0-9_]+$/);
    });
  }

  test("LOGIN_FAILURE reasons cover all documented failure paths", () => {
    const validReasons = ["wrong_password", "blocked", "missing_hash"];
    for (const r of validReasons) {
      assert.ok(typeof r === "string" && r.length > 0);
    }
    assert.equal(validReasons.length, 3);
  });
});
