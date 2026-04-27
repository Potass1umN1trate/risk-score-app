import "server-only";

import { findUserById } from "@/lib/db";
import { hasRequiredRole, type Role } from "@/lib/rbac";

export type FreshAuthorizationResult =
  | { ok: true; user: { id: string; email: string; role: Role } }
  | {
      ok: false;
      status: 401 | 403 | 500;
      reason:
        | "unauthenticated"
        | "blocked"
        | "forbidden"
        | "not_found"
        | "auth_unavailable";
    };

export async function authorizeFreshUser(
  userId: string | undefined,
  requiredRole: Role
): Promise<FreshAuthorizationResult> {
  if (!userId) {
    return { ok: false, status: 401, reason: "unauthenticated" };
  }

  let user;
  try {
    user = await findUserById(userId);
  } catch {
    return { ok: false, status: 500, reason: "auth_unavailable" };
  }
  if (!user) {
    return { ok: false, status: 403, reason: "not_found" };
  }

  if (user.isBlocked) {
    return { ok: false, status: 403, reason: "blocked" };
  }

  if (!hasRequiredRole(user.role, requiredRole)) {
    return { ok: false, status: 403, reason: "forbidden" };
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
}
