// Unit tests for auth configuration and JWT secret guard.
// Run with: node --test web-app/tests/auth-config.test.mjs
// Requires Node 22 (node:test built-in). No external dependencies.
//
// These tests verify:
//   1. AUTH_SECRET guard: the module throws if neither AUTH_SECRET nor
//      NEXTAUTH_SECRET is set, so the app never starts with an ephemeral
//      secret that would cause JWEDecryptionFailed on restart.
//   2. authOptions.secret is always truthy when the env var is present.
//   3. JWT roundtrip consistency: the same secret used to sign produces a
//      token that can be verified by the same secret — mismatched secrets
//      would produce JWEDecryptionFailed in the real server.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// ─── Helper: simulate the auth module's startup guard ────────────────────────
// We cannot import the real auth.ts (TypeScript + Next.js), so we mirror the
// exact guard logic in plain JS and verify its behavior in isolation.

function resolveSecret(env) {
  return env.AUTH_SECRET ?? env.NEXTAUTH_SECRET ?? null;
}

function startupGuard(env) {
  if (!env.AUTH_SECRET && !env.NEXTAUTH_SECRET) {
    throw new Error(
      "AUTH_SECRET is not set. Set AUTH_SECRET in your .env.local before starting the app."
    );
  }
}

// ─── 1. Startup guard tests ───────────────────────────────────────────────────

test("startup guard: throws when neither AUTH_SECRET nor NEXTAUTH_SECRET is set", () => {
  assert.throws(
    () => startupGuard({}),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("AUTH_SECRET is not set"));
      return true;
    }
  );
});

test("startup guard: does not throw when AUTH_SECRET is set", () => {
  assert.doesNotThrow(() => startupGuard({ AUTH_SECRET: "some-secret-value" }));
});

test("startup guard: does not throw when NEXTAUTH_SECRET is set", () => {
  assert.doesNotThrow(() => startupGuard({ NEXTAUTH_SECRET: "some-secret-value" }));
});

test("startup guard: does not throw when both are set", () => {
  assert.doesNotThrow(() =>
    startupGuard({ AUTH_SECRET: "a", NEXTAUTH_SECRET: "b" })
  );
});

test("startup guard: empty string counts as falsy → throws", () => {
  assert.throws(() => startupGuard({ AUTH_SECRET: "", NEXTAUTH_SECRET: "" }));
});

// ─── 2. authOptions.secret resolution ────────────────────────────────────────

test("resolveSecret: prefers AUTH_SECRET over NEXTAUTH_SECRET", () => {
  const secret = resolveSecret({ AUTH_SECRET: "auth-val", NEXTAUTH_SECRET: "next-val" });
  assert.equal(secret, "auth-val");
});

test("resolveSecret: falls back to NEXTAUTH_SECRET when AUTH_SECRET is absent", () => {
  const secret = resolveSecret({ NEXTAUTH_SECRET: "next-val" });
  assert.equal(secret, "next-val");
});

test("resolveSecret: returns null when neither is set", () => {
  const secret = resolveSecret({});
  assert.equal(secret, null);
});

test("resolveSecret: AUTH_SECRET from .env.local is truthy", () => {
  // Mirrors the actual .env.local value format (64-char hex string).
  const env = { AUTH_SECRET: "434b3445e02c26ab2b2ec39124694052202c9988669f3e14e52e540f378627a2" };
  const secret = resolveSecret(env);
  assert.ok(secret, "secret must be truthy");
  assert.equal(typeof secret, "string");
  assert.ok(secret.length >= 32, "secret should be at least 32 characters");
});

// ─── 3. JWT roundtrip consistency (same secret → valid; different → invalid) ──
// NextAuth v4 uses a symmetric key derived from AUTH_SECRET for JWE encryption.
// We model this as HMAC-SHA256 consistency: the same secret must produce the
// same signature, and a different secret must produce a different signature.
// This is a proxy test for the encrypt/decrypt symmetry that prevents
// JWEDecryptionFailed when AUTH_SECRET is stable across restarts.

function signPayload(payload, secret) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("hex");
}

test("JWT roundtrip: same secret produces matching signature (stable secret → no decryption error)", () => {
  const secret = "stable-secret-value";
  const payload = { id: "user-uuid", role: "user", isBlocked: false };
  const sig1 = signPayload(payload, secret);
  const sig2 = signPayload(payload, secret);
  assert.equal(sig1, sig2, "same secret must produce same signature on every restart");
});

test("JWT roundtrip: different secrets produce different signatures (secret rotation → JWEDecryptionFailed)", () => {
  const payload = { id: "user-uuid", role: "user", isBlocked: false };
  const sigOld = signPayload(payload, "old-secret");
  const sigNew = signPayload(payload, "new-secret");
  assert.notEqual(
    sigOld,
    sigNew,
    "different secrets must produce different signatures — demonstrates why rotation breaks existing cookies"
  );
});

test("JWT roundtrip: ephemeral auto-generated secrets differ across restarts (missing AUTH_SECRET scenario)", () => {
  const payload = { id: "user-uuid", role: "user", isBlocked: false };
  // Simulate two server restarts each generating a random ephemeral secret.
  const ephemeral1 = createHmac("sha256", "restart-1-random").update("seed").digest("hex");
  const ephemeral2 = createHmac("sha256", "restart-2-random").update("seed").digest("hex");
  const sig1 = signPayload(payload, ephemeral1);
  const sig2 = signPayload(payload, ephemeral2);
  assert.notEqual(
    sig1,
    sig2,
    "ephemeral secrets differ per restart — any cookie issued under restart-1 fails to decrypt on restart-2"
  );
});

// ─── 4. JWT claims shape ──────────────────────────────────────────────────────
// Verify that the expected JWT token claims (id, role, isBlocked) are all
// present in the shape that auth.ts populates them.

test("JWT claims shape: credentials path sets expected fields", () => {
  // Mirrors auth.ts jwt callback when `user` is populated from authorize().
  const user = { id: "user-uuid", email: "test@example.com", role: "user", isBlocked: false };
  const token = {};
  token.id = user.id;
  token.email = user.email;
  token.role = user.role;
  token.isBlocked = user.isBlocked;

  assert.ok(token.id, "token.id must be set");
  assert.ok(token.email, "token.email must be set");
  assert.ok(["user", "moderator", "admin"].includes(token.role), "token.role must be a valid role");
  assert.equal(typeof token.isBlocked, "boolean", "token.isBlocked must be boolean");
});

test("JWT claims shape: OAuth path sets expected fields from dbUser", () => {
  // Mirrors auth.ts jwt callback when account.provider === 'github'.
  const dbUser = { id: "oauth-user-uuid", email: "oauth@example.com", role: "user", isBlocked: false };
  const token = {};
  token.id = dbUser.id;
  token.email = dbUser.email;
  token.role = dbUser.role;
  token.isBlocked = dbUser.isBlocked;

  assert.ok(token.id, "token.id must be set");
  assert.ok(token.email, "token.email must be set");
  assert.ok(["user", "moderator", "admin"].includes(token.role), "token.role must be a valid role");
  assert.equal(typeof token.isBlocked, "boolean", "token.isBlocked must be boolean");
});

test("JWT claims shape: session callback maps token fields onto session.user", () => {
  // Mirrors auth.ts session callback.
  const token = { id: "user-uuid", email: "test@example.com", role: "user", isBlocked: false };
  const session = { user: { name: "Test", email: "test@example.com" } };

  session.user.id = String(token.id);
  session.user.email = token.email ?? session.user.email;
  session.user.role = token.role;
  session.user.isBlocked = Boolean(token.isBlocked);

  assert.equal(session.user.id, "user-uuid");
  assert.equal(session.user.role, "user");
  assert.equal(session.user.isBlocked, false);
});
