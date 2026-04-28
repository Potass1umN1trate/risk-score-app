// Unit tests for GitHub OAuth auth.ts callback logic.
// Run with: node --test web-app/tests/api-oauth-flow.test.mjs
// Requires Node 22 (node:test built-in). No DB, network, or NextAuth dependency.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ─── Inline logic under test ──────────────────────────────────────────────────
// We inline the signIn and jwt callback branching logic from auth.ts so tests
// have zero imports and run without a DB or GitHub API.

// Simulates findOrCreateOAuthUser return values for test control.
function makeDbUser(overrides = {}) {
  return {
    id: "user-uuid-1",
    email: "alice@example.com",
    role: "user",
    isBlocked: false,
    ...overrides,
  };
}

// Inline signIn callback logic (mirrors auth.ts signIn callback).
async function signInCallback({ account, profile }, findOrCreateOAuthUser) {
  if (account?.provider === "github") {
    const email = profile?.email;
    if (!email) return false;
    try {
      const user = await findOrCreateOAuthUser(account.provider, account.providerAccountId, email);
      if (user.isBlocked) return false;
      return true;
    } catch {
      return false;
    }
  }
  return true; // credentials always passes here
}

// Inline jwt callback logic (mirrors auth.ts jwt callback).
async function jwtCallback({ token, user, account, profile }, findOrCreateOAuthUser) {
  // Credentials path.
  if (user) {
    token.id = user.id;
    token.email = user.email;
    token.role = user.role;
    token.isBlocked = user.isBlocked;
  }
  // GitHub OAuth first sign-in path.
  if (account?.provider === "github" && profile?.email) {
    try {
      const dbUser = await findOrCreateOAuthUser(account.provider, account.providerAccountId, profile.email);
      token.id = dbUser.id;
      token.email = dbUser.email;
      token.role = dbUser.role;
      token.isBlocked = dbUser.isBlocked;
    } catch {
      // leave token claims unset
    }
  }
  return token;
}

// ─── signIn callback tests ─────────────────────────────────────────────────────

describe("signIn callback — GitHub provider", () => {
  test("allows sign-in for valid unblocked GitHub user", async () => {
    const dbUser = makeDbUser();
    const result = await signInCallback(
      {
        account: { provider: "github", providerAccountId: "gh-1" },
        profile: { email: "alice@example.com" },
      },
      async () => dbUser
    );
    assert.equal(result, true);
  });

  test("denies sign-in for blocked GitHub user", async () => {
    const dbUser = makeDbUser({ isBlocked: true });
    const result = await signInCallback(
      {
        account: { provider: "github", providerAccountId: "gh-1" },
        profile: { email: "alice@example.com" },
      },
      async () => dbUser
    );
    assert.equal(result, false);
  });

  test("denies sign-in when GitHub profile has no email", async () => {
    const result = await signInCallback(
      {
        account: { provider: "github", providerAccountId: "gh-1" },
        profile: {},
      },
      async () => { throw new Error("should not be called"); }
    );
    assert.equal(result, false);
  });

  test("denies sign-in when findOrCreateOAuthUser throws", async () => {
    const result = await signInCallback(
      {
        account: { provider: "github", providerAccountId: "gh-1" },
        profile: { email: "alice@example.com" },
      },
      async () => { throw new Error("DB error"); }
    );
    assert.equal(result, false);
  });

  test("allows sign-in for credentials provider unconditionally", async () => {
    const result = await signInCallback(
      { account: { provider: "credentials" }, profile: undefined },
      async () => { throw new Error("should not be called"); }
    );
    assert.equal(result, true);
  });

  test("allows sign-in when account is undefined (safety guard)", async () => {
    const result = await signInCallback(
      { account: undefined, profile: undefined },
      async () => { throw new Error("should not be called"); }
    );
    assert.equal(result, true);
  });
});

// ─── jwt callback tests ────────────────────────────────────────────────────────

describe("jwt callback — GitHub OAuth first sign-in", () => {
  test("populates id, email, role, isBlocked on first GitHub sign-in", async () => {
    const dbUser = makeDbUser();
    const token = {};
    const result = await jwtCallback(
      {
        token,
        user: undefined,
        account: { provider: "github", providerAccountId: "gh-1" },
        profile: { email: "alice@example.com" },
      },
      async () => dbUser
    );
    assert.equal(result.id, "user-uuid-1");
    assert.equal(result.email, "alice@example.com");
    assert.equal(result.role, "user");
    assert.equal(result.isBlocked, false);
  });

  test("populated isBlocked=true reflects blocked status in token", async () => {
    const dbUser = makeDbUser({ isBlocked: true });
    const token = {};
    const result = await jwtCallback(
      {
        token,
        user: undefined,
        account: { provider: "github", providerAccountId: "gh-1" },
        profile: { email: "alice@example.com" },
      },
      async () => dbUser
    );
    assert.equal(result.isBlocked, true);
  });

  test("leaves token claims unset if findOrCreateOAuthUser throws", async () => {
    const token = { existingClaim: "preserved" };
    const result = await jwtCallback(
      {
        token,
        user: undefined,
        account: { provider: "github", providerAccountId: "gh-1" },
        profile: { email: "alice@example.com" },
      },
      async () => { throw new Error("DB error"); }
    );
    assert.equal(result.id, undefined);
    assert.equal(result.role, undefined);
    assert.equal(result.existingClaim, "preserved");
  });

  test("existing token claims are preserved on token refresh (no account)", async () => {
    const token = { id: "user-uuid-1", email: "alice@example.com", role: "user", isBlocked: false };
    const result = await jwtCallback(
      { token, user: undefined, account: undefined, profile: undefined },
      async () => { throw new Error("should not be called"); }
    );
    assert.equal(result.id, "user-uuid-1");
    assert.equal(result.role, "user");
  });
});

describe("jwt callback — credentials provider path", () => {
  test("populates claims from user object (credentials authorize result)", async () => {
    const token = {};
    const user = { id: "creds-uuid", email: "bob@example.com", role: "admin", isBlocked: false };
    const result = await jwtCallback(
      { token, user, account: { provider: "credentials" }, profile: undefined },
      async () => { throw new Error("should not be called"); }
    );
    assert.equal(result.id, "creds-uuid");
    assert.equal(result.email, "bob@example.com");
    assert.equal(result.role, "admin");
    assert.equal(result.isBlocked, false);
  });
});

// ─── Middleware interaction tests ─────────────────────────────────────────────

describe("middleware RBAC with OAuth-provisioned JWT claims", () => {
  const ROLE_RANK = { user: 1, moderator: 2, admin: 3 };

  function middlewareDecision(pathname, token) {
    const isApi = pathname.startsWith("/api/");
    if (!token) return isApi ? 401 : "redirect-login";
    if (token.isBlocked) return isApi ? 403 : "redirect-unauthorized";
    const rank = ROLE_RANK[token.role];
    if (!rank) return isApi ? 403 : "redirect-unauthorized";
    return "next";
  }

  test("OAuth user with role=user and isBlocked=false passes /api/analyze", () => {
    const token = { id: "user-uuid-1", role: "user", isBlocked: false };
    assert.equal(middlewareDecision("/api/analyze", token), "next");
  });

  test("OAuth user with role=user and isBlocked=false passes /dashboard", () => {
    const token = { id: "user-uuid-1", role: "user", isBlocked: false };
    assert.equal(middlewareDecision("/dashboard", token), "next");
  });

  test("OAuth user with isBlocked=true is denied at /api/analyze", () => {
    const token = { id: "user-uuid-1", role: "user", isBlocked: true };
    assert.equal(middlewareDecision("/api/analyze", token), 403);
  });

  test("OAuth user with missing role claim is denied at /api/history", () => {
    const token = { id: "user-uuid-1", isBlocked: false }; // role undefined
    assert.equal(middlewareDecision("/api/history", token), 403);
  });

  test("no token returns 401 for API paths", () => {
    assert.equal(middlewareDecision("/api/analyze", null), 401);
  });
});
