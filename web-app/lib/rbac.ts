export const ROLES = ["user", "moderator", "admin"] as const;

export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  user: 1,
  moderator: 2,
  admin: 3,
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role);
}

export function strongestRole(roles: unknown[]): Role | null {
  return roles.reduce<Role | null>((best, role) => {
    if (!isRole(role)) return best;
    if (best === null || ROLE_RANK[role] > ROLE_RANK[best]) return role;
    return best;
  }, null);
}

export function hasRequiredRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

export function requiredRoleForPath(pathname: string): Role | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/moderator" || pathname.startsWith("/moderator/")) return "moderator";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return "user";
  if (pathname === "/analyze" || pathname.startsWith("/analyze/")) return "user";

  if (pathname === "/api/analyze") return "user";
  if (pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/moderator/")) return "moderator";
  if (pathname.startsWith("/api/history/")) return "user";
  if (pathname.startsWith("/api/flagged-addresses/")) return "moderator";

  return null;
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}
