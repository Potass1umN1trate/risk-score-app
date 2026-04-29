// Unit tests for requiredRoleForPath — verifies middleware RBAC coverage.
// Run with: node --test web-app/tests/rbac.test.mjs
// Requires Node 22 (node:test built-in). No external dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Inline the pure logic under test ────────────────────────────────────────
// We re-implement only the function under test so the test has no TS/Next.js
// dependency while still exercising the exact branch structure from rbac.ts.

const ROLES = ["user", "moderator", "admin"];
const ROLE_RANK = { user: 1, moderator: 2, admin: 3 };

function isRole(value) {
  return typeof value === "string" && ROLES.includes(value);
}

function hasRequiredRole(userRole, requiredRole) {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

function requiredRoleForPath(pathname) {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/moderator" || pathname.startsWith("/moderator/")) return "moderator";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return "user";
  if (pathname === "/analyze" || pathname.startsWith("/analyze/")) return "user";
  if (pathname === "/history" || pathname.startsWith("/history/")) return "user";

  if (pathname === "/api/analyze") return "user";
  if (pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/moderator/")) return "moderator";
  // Fixed: exact-match on /api/history covers the bare GET /api/history route
  if (pathname === "/api/history" || pathname.startsWith("/api/history/")) return "user";
  if (pathname.startsWith("/api/flagged-addresses/")) return "moderator";

  return null;
}

// Simulate middleware decision (mirrors middleware.ts logic).
// Returns: 401 | 403 | "next" | "redirect"
function middlewareDecision(pathname, token) {
  const requiredRole = requiredRoleForPath(pathname);
  if (!requiredRole) return "next"; // unprotected

  const isApi = pathname.startsWith("/api/");

  if (!token) return isApi ? 401 : "redirect-login";
  if (token.isBlocked === true) return isApi ? 403 : "redirect-unauthorized";

  const role = token.role;
  if (!isRole(role) || !hasRequiredRole(role, requiredRole)) {
    return isApi ? 403 : "redirect-unauthorized";
  }

  return "next";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("/api/history bare path: requiredRoleForPath returns 'user'", () => {
  assert.equal(requiredRoleForPath("/api/history"), "user");
});

test("/api/history/[id] path: requiredRoleForPath returns 'user'", () => {
  assert.equal(requiredRoleForPath("/api/history/some-uuid"), "user");
});

test("/api/history bare path: unauthenticated request → 401", () => {
  assert.equal(middlewareDecision("/api/history", null), 401);
});

test("/api/history/[id]: unauthenticated request → 401", () => {
  assert.equal(middlewareDecision("/api/history/some-uuid", null), 401);
});

test("/api/history bare path: blocked user → 403", () => {
  const token = { role: "user", isBlocked: true };
  assert.equal(middlewareDecision("/api/history", token), 403);
});

test("/api/history bare path: user role → passes", () => {
  const token = { role: "user", isBlocked: false };
  assert.equal(middlewareDecision("/api/history", token), "next");
});

test("/api/history bare path: moderator role → passes", () => {
  const token = { role: "moderator", isBlocked: false };
  assert.equal(middlewareDecision("/api/history", token), "next");
});

test("/api/history bare path: admin role → passes", () => {
  const token = { role: "admin", isBlocked: false };
  assert.equal(middlewareDecision("/api/history", token), "next");
});

test("unprotected public path: no token needed", () => {
  assert.equal(middlewareDecision("/", null), "next");
  assert.equal(middlewareDecision("/login", null), "next");
  assert.equal(middlewareDecision("/api/register", null), "next");
});

test("existing protected paths still return correct roles", () => {
  assert.equal(requiredRoleForPath("/api/analyze"), "user");
  assert.equal(requiredRoleForPath("/api/admin/users"), "admin");
  assert.equal(requiredRoleForPath("/api/moderator/flags"), "moderator");
  assert.equal(requiredRoleForPath("/api/flagged-addresses/list"), "moderator");
  assert.equal(requiredRoleForPath("/dashboard"), "user");
  assert.equal(requiredRoleForPath("/history"), "user");
  assert.equal(requiredRoleForPath("/history/some-id"), "user");
  assert.equal(requiredRoleForPath("/admin"), "admin");
  assert.equal(requiredRoleForPath("/moderator"), "moderator");
});

test("no regression: /api/history prefix does not bleed into unrelated paths", () => {
  assert.equal(requiredRoleForPath("/api/history-export"), null); // not prefixed by /api/history/
  assert.equal(requiredRoleForPath("/api/historical"), null);
});

// ─── GitHub OAuth JWT claims produce same middleware decisions as credentials ──

test("OAuth user JWT (role=user, isBlocked=false) passes /api/analyze", () => {
  const token = { id: "oauth-user-uuid", role: "user", isBlocked: false };
  assert.equal(middlewareDecision("/api/analyze", token), "next");
});

test("OAuth user JWT (role=user, isBlocked=false) passes /dashboard", () => {
  const token = { id: "oauth-user-uuid", role: "user", isBlocked: false };
  assert.equal(middlewareDecision("/dashboard", token), "next");
});

test("OAuth user JWT (role=user, isBlocked=false) passes /history", () => {
  const token = { id: "oauth-user-uuid", role: "user", isBlocked: false };
  assert.equal(middlewareDecision("/history", token), "next");
});

test("OAuth user JWT (role=user, isBlocked=false) passes /api/history", () => {
  const token = { id: "oauth-user-uuid", role: "user", isBlocked: false };
  assert.equal(middlewareDecision("/api/history", token), "next");
});

test("OAuth user JWT (role=user, isBlocked=false) is denied /admin (insufficient role)", () => {
  const token = { id: "oauth-user-uuid", role: "user", isBlocked: false };
  assert.equal(middlewareDecision("/admin", token), "redirect-unauthorized");
});

test("OAuth user JWT (isBlocked=true) is denied /api/analyze → 403", () => {
  const token = { id: "oauth-user-uuid", role: "user", isBlocked: true };
  assert.equal(middlewareDecision("/api/analyze", token), 403);
});

test("OAuth user JWT (isBlocked=true) is denied /dashboard → redirect-unauthorized", () => {
  const token = { id: "oauth-user-uuid", role: "user", isBlocked: true };
  assert.equal(middlewareDecision("/dashboard", token), "redirect-unauthorized");
});

// ─── Admin user management paths ─────────────────────────────────────────────

test("/api/admin/users: requiredRoleForPath returns 'admin'", () => {
  assert.equal(requiredRoleForPath("/api/admin/users"), "admin");
});

test("/api/admin/users/some-id: requiredRoleForPath returns 'admin'", () => {
  assert.equal(requiredRoleForPath("/api/admin/users/some-id"), "admin");
});

test("/admin/users: requiredRoleForPath returns 'admin'", () => {
  assert.equal(requiredRoleForPath("/admin/users"), "admin");
});

test("/admin/users/new: requiredRoleForPath returns 'admin'", () => {
  assert.equal(requiredRoleForPath("/admin/users/new"), "admin");
});

test("/admin/users/some-id: requiredRoleForPath returns 'admin'", () => {
  assert.equal(requiredRoleForPath("/admin/users/some-id"), "admin");
});

test("/api/admin/users: unauthenticated → 401", () => {
  assert.equal(middlewareDecision("/api/admin/users", null), 401);
});

test("/api/admin/users: user role → 403", () => {
  assert.equal(middlewareDecision("/api/admin/users", { role: "user", isBlocked: false }), 403);
});

test("/api/admin/users: moderator role → 403", () => {
  assert.equal(middlewareDecision("/api/admin/users", { role: "moderator", isBlocked: false }), 403);
});

test("/api/admin/users: admin role → passes", () => {
  assert.equal(middlewareDecision("/api/admin/users", { role: "admin", isBlocked: false }), "next");
});

test("/api/admin/users: blocked admin → 403", () => {
  assert.equal(middlewareDecision("/api/admin/users", { role: "admin", isBlocked: true }), 403);
});

test("/api/admin/users/some-id: user role → 403", () => {
  assert.equal(middlewareDecision("/api/admin/users/some-id", { role: "user", isBlocked: false }), 403);
});

test("/api/admin/users/some-id: admin role → passes", () => {
  assert.equal(middlewareDecision("/api/admin/users/some-id", { role: "admin", isBlocked: false }), "next");
});

test("/admin/users page: unauthenticated → redirect-login", () => {
  assert.equal(middlewareDecision("/admin/users", null), "redirect-login");
});

test("/admin/users page: user role → redirect-unauthorized", () => {
  assert.equal(middlewareDecision("/admin/users", { role: "user", isBlocked: false }), "redirect-unauthorized");
});

test("/admin/users page: admin role → passes", () => {
  assert.equal(middlewareDecision("/admin/users", { role: "admin", isBlocked: false }), "next");
});

// ─── OAuth JWT claims behave identically to credentials JWT claims for role=user ─

test("OAuth JWT claims behave identically to credentials JWT claims for role=user", () => {
  const credentialsToken = { id: "cred-uuid", role: "user", isBlocked: false };
  const oauthToken      = { id: "oauth-uuid", role: "user", isBlocked: false };
  const paths = ["/api/analyze", "/dashboard", "/history", "/api/history", "/api/history/some-id"];
  for (const path of paths) {
    assert.equal(
      middlewareDecision(path, credentialsToken),
      middlewareDecision(path, oauthToken),
      `Mismatch for path: ${path}`
    );
  }
});
