// Unit tests for requiredRoleForPath — flagged-addresses paths.
// Run with: node --test web-app/tests/rbac-flagged.test.mjs
// Requires Node 22 (node:test built-in). No external dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Inline pure logic mirroring rbac.ts ─────────────────────────────────────

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
  if (pathname === "/flagged-addresses" || pathname.startsWith("/flagged-addresses/")) return "moderator";

  if (pathname === "/api/analyze") return "user";
  if (pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/moderator/")) return "moderator";
  if (pathname === "/api/history" || pathname.startsWith("/api/history/")) return "user";
  if (pathname === "/api/flagged-addresses" || pathname.startsWith("/api/flagged-addresses/")) return "moderator";

  return null;
}

function middlewareDecision(pathname, token) {
  const requiredRole = requiredRoleForPath(pathname);
  if (!requiredRole) return "next";

  const isApi = pathname.startsWith("/api/");

  if (!token) return isApi ? 401 : "redirect-login";
  if (token.isBlocked === true) return isApi ? 403 : "redirect-unauthorized";

  const role = token.role;
  if (!isRole(role) || !hasRequiredRole(role, requiredRole)) {
    return isApi ? 403 : "redirect-unauthorized";
  }

  return "next";
}

// ─── Page path tests ──────────────────────────────────────────────────────────

test("/flagged-addresses: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/flagged-addresses"), "moderator");
});

test("/flagged-addresses/new: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/flagged-addresses/new"), "moderator");
});

test("/flagged-addresses/[id]: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/flagged-addresses/some-uuid"), "moderator");
});

test("/flagged-addresses: unauthenticated → redirect-login", () => {
  assert.equal(middlewareDecision("/flagged-addresses", null), "redirect-login");
});

test("/flagged-addresses: blocked user → redirect-unauthorized", () => {
  assert.equal(middlewareDecision("/flagged-addresses", { role: "moderator", isBlocked: true }), "redirect-unauthorized");
});

test("/flagged-addresses: user role → redirect-unauthorized", () => {
  assert.equal(middlewareDecision("/flagged-addresses", { role: "user", isBlocked: false }), "redirect-unauthorized");
});

test("/flagged-addresses: moderator role → next", () => {
  assert.equal(middlewareDecision("/flagged-addresses", { role: "moderator", isBlocked: false }), "next");
});

test("/flagged-addresses: admin role → next", () => {
  assert.equal(middlewareDecision("/flagged-addresses", { role: "admin", isBlocked: false }), "next");
});

// ─── API path tests ───────────────────────────────────────────────────────────

test("/api/flagged-addresses bare: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/api/flagged-addresses"), "moderator");
});

test("/api/flagged-addresses/[id]: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/api/flagged-addresses/some-uuid"), "moderator");
});

test("/api/flagged-addresses/export: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/api/flagged-addresses/export"), "moderator");
});

test("/api/flagged-addresses/import: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/api/flagged-addresses/import"), "moderator");
});

test("/api/flagged-addresses/networks: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/api/flagged-addresses/networks"), "moderator");
});

test("/api/flagged-addresses/categories: requiredRoleForPath returns 'moderator'", () => {
  assert.equal(requiredRoleForPath("/api/flagged-addresses/categories"), "moderator");
});

test("/api/flagged-addresses: unauthenticated → 401", () => {
  assert.equal(middlewareDecision("/api/flagged-addresses", null), 401);
});

test("/api/flagged-addresses: blocked user → 403", () => {
  assert.equal(middlewareDecision("/api/flagged-addresses", { role: "moderator", isBlocked: true }), 403);
});

test("/api/flagged-addresses: user role → 403", () => {
  assert.equal(middlewareDecision("/api/flagged-addresses", { role: "user", isBlocked: false }), 403);
});

test("/api/flagged-addresses: moderator role → next", () => {
  assert.equal(middlewareDecision("/api/flagged-addresses", { role: "moderator", isBlocked: false }), "next");
});

test("/api/flagged-addresses: admin role → next", () => {
  assert.equal(middlewareDecision("/api/flagged-addresses", { role: "admin", isBlocked: false }), "next");
});

test("/api/flagged-addresses/export: moderator → next (moderator has export access)", () => {
  assert.equal(middlewareDecision("/api/flagged-addresses/export", { role: "moderator", isBlocked: false }), "next");
});

test("/api/flagged-addresses/import: moderator → next (moderator has import access)", () => {
  assert.equal(middlewareDecision("/api/flagged-addresses/import", { role: "moderator", isBlocked: false }), "next");
});

// ─── No bleed into unrelated paths ───────────────────────────────────────────

test("no regression: /api/flagged prefix does not bleed", () => {
  assert.equal(requiredRoleForPath("/api/flagged"), null);
  assert.equal(requiredRoleForPath("/flagged"), null);
});

test("no regression: existing paths still correct after adding flagged-addresses", () => {
  assert.equal(requiredRoleForPath("/api/history"), "user");
  assert.equal(requiredRoleForPath("/api/analyze"), "user");
  assert.equal(requiredRoleForPath("/api/admin/users"), "admin");
  assert.equal(requiredRoleForPath("/dashboard"), "user");
  assert.equal(requiredRoleForPath("/history"), "user");
  assert.equal(requiredRoleForPath("/admin"), "admin");
  assert.equal(requiredRoleForPath("/moderator"), "moderator");
  assert.equal(requiredRoleForPath("/"), null);
  assert.equal(requiredRoleForPath("/login"), null);
});
