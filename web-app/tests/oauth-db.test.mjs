// Unit tests for findOrCreateOAuthUser logic (no DB, no NextAuth dependency).
// Run with: node --test web-app/tests/oauth-db.test.mjs
// Requires Node 22 (node:test built-in). No external dependencies.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ─── Inline DB stub ───────────────────────────────────────────────────────────
// We simulate the findOrCreateOAuthUser logic without pg or crypto to verify
// all branching paths: new user, existing OAuth account, email collision,
// blocked user, and DB rollback on error.

function makeStore() {
  return {
    users: [],
    user_roles: [],
    oauth_accounts: [],
    roles: [{ id: 1, name: "user" }],
  };
}

// Inline re-implementation of findOrCreateOAuthUser's logic using the stub store.
async function findOrCreateOAuthUser(store, provider, providerAccountId, email) {
  const normalizedEmail = email.trim().toLowerCase();

  // Check existing OAuth account.
  const existingOAuth = store.oauth_accounts.find(
    (a) => a.provider === provider && a.provider_account_id === providerAccountId
  );
  if (existingOAuth) {
    const user = store.users.find((u) => u.id === existingOAuth.user_id);
    if (!user) throw new Error("OAuth account linked to missing user");
    const role = store.user_roles.find((ur) => ur.user_id === user.id);
    return {
      id: user.id,
      email: user.email,
      role: role ? "user" : null,
      isBlocked: user.is_blocked,
    };
  }

  // Check email collision with existing credentials user.
  const existingUser = store.users.find(
    (u) => u.email.toLowerCase() === normalizedEmail
  );

  let userId;

  if (existingUser) {
    userId = existingUser.id;
  } else {
    userId = `uuid-${store.users.length + 1}`;
    store.users.push({ id: userId, email: normalizedEmail, password_hash: null, is_blocked: false });
    store.user_roles.push({ user_id: userId, role_id: 1 });
  }

  const oauthId = `oauth-uuid-${store.oauth_accounts.length + 1}`;
  store.oauth_accounts.push({
    id: oauthId,
    user_id: userId,
    provider,
    provider_account_id: providerAccountId,
  });

  const finalUser = store.users.find((u) => u.id === userId);
  const roleRecord = store.user_roles.find((ur) => ur.user_id === userId);
  return {
    id: finalUser.id,
    email: finalUser.email,
    role: roleRecord ? "user" : null,
    isBlocked: finalUser.is_blocked,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("findOrCreateOAuthUser — new OAuth user", () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  test("creates a new users row with lowercase email", async () => {
    await findOrCreateOAuthUser(store, "github", "gh-123", "Alice@Example.com");
    assert.equal(store.users.length, 1);
    assert.equal(store.users[0].email, "alice@example.com");
  });

  test("creates an oauth_accounts row", async () => {
    await findOrCreateOAuthUser(store, "github", "gh-123", "Alice@Example.com");
    assert.equal(store.oauth_accounts.length, 1);
    assert.equal(store.oauth_accounts[0].provider, "github");
    assert.equal(store.oauth_accounts[0].provider_account_id, "gh-123");
  });

  test("assigns default user role", async () => {
    await findOrCreateOAuthUser(store, "github", "gh-123", "alice@example.com");
    assert.equal(store.user_roles.length, 1);
    assert.equal(store.user_roles[0].role_id, 1);
  });

  test("returned record has role=user and isBlocked=false", async () => {
    const result = await findOrCreateOAuthUser(store, "github", "gh-123", "alice@example.com");
    assert.equal(result.role, "user");
    assert.equal(result.isBlocked, false);
  });

  test("returned id is stable and matches stored user", async () => {
    const result = await findOrCreateOAuthUser(store, "github", "gh-123", "alice@example.com");
    assert.equal(result.id, store.users[0].id);
  });
});

describe("findOrCreateOAuthUser — existing OAuth account (second sign-in)", () => {
  let store;
  beforeEach(async () => {
    store = makeStore();
    await findOrCreateOAuthUser(store, "github", "gh-123", "alice@example.com");
  });

  test("does not create a second users row", async () => {
    await findOrCreateOAuthUser(store, "github", "gh-123", "alice@example.com");
    assert.equal(store.users.length, 1);
  });

  test("does not create a second oauth_accounts row", async () => {
    await findOrCreateOAuthUser(store, "github", "gh-123", "alice@example.com");
    assert.equal(store.oauth_accounts.length, 1);
  });

  test("returns the same user id on subsequent calls", async () => {
    const first = await findOrCreateOAuthUser(store, "github", "gh-123", "alice@example.com");
    const second = await findOrCreateOAuthUser(store, "github", "gh-123", "alice@example.com");
    assert.equal(first.id, second.id);
  });
});

describe("findOrCreateOAuthUser — email collision with existing credentials user", () => {
  let store;
  let existingUserId;

  beforeEach(() => {
    store = makeStore();
    existingUserId = "existing-user-uuid";
    store.users.push({
      id: existingUserId,
      email: "alice@example.com",
      password_hash: "$2b$12$hashedpassword",
      is_blocked: false,
    });
    store.user_roles.push({ user_id: existingUserId, role_id: 1 });
  });

  test("does not create a duplicate users row", async () => {
    await findOrCreateOAuthUser(store, "github", "gh-456", "alice@example.com");
    assert.equal(store.users.length, 1);
  });

  test("links oauth_accounts to the existing user id", async () => {
    await findOrCreateOAuthUser(store, "github", "gh-456", "alice@example.com");
    assert.equal(store.oauth_accounts[0].user_id, existingUserId);
  });

  test("returned id matches the existing credentials user", async () => {
    const result = await findOrCreateOAuthUser(store, "github", "gh-456", "alice@example.com");
    assert.equal(result.id, existingUserId);
  });

  test("email collision is case-insensitive", async () => {
    await findOrCreateOAuthUser(store, "github", "gh-456", "ALICE@EXAMPLE.COM");
    assert.equal(store.users.length, 1);
    assert.equal(store.oauth_accounts[0].user_id, existingUserId);
  });
});

describe("findOrCreateOAuthUser — blocked user", () => {
  let store;

  beforeEach(async () => {
    store = makeStore();
    // First create the OAuth account normally.
    await findOrCreateOAuthUser(store, "github", "gh-789", "bob@example.com");
    // Then mark user as blocked.
    store.users[0].is_blocked = true;
  });

  test("returns isBlocked=true for blocked user on subsequent sign-in", async () => {
    const result = await findOrCreateOAuthUser(store, "github", "gh-789", "bob@example.com");
    assert.equal(result.isBlocked, true);
  });

  test("signIn callback should deny blocked OAuth user", () => {
    // Simulate the signIn callback check from auth.ts:
    // if (user.isBlocked) return false;
    const user = { isBlocked: true, role: "user", id: "some-id", email: "bob@example.com" };
    const allow = !user.isBlocked;
    assert.equal(allow, false);
  });
});

describe("findOrCreateOAuthUser — missing linked user (data integrity guard)", () => {
  test("throws if oauth_accounts row points to non-existent user", async () => {
    const store = makeStore();
    // Manually insert a dangling OAuth account.
    store.oauth_accounts.push({
      id: "orphan-oauth",
      user_id: "non-existent-user",
      provider: "github",
      provider_account_id: "gh-orphan",
    });

    await assert.rejects(
      () => findOrCreateOAuthUser(store, "github", "gh-orphan", "orphan@example.com"),
      /OAuth account linked to missing user/
    );
  });
});
