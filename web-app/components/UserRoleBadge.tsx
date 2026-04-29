import type { Role } from "@/lib/rbac";

const STYLES: Record<Role, string> = {
  admin: "badge badge-admin",
  moderator: "badge badge-moderator",
  user: "badge badge-user",
};

export function UserRoleBadge({ role }: { role: Role }) {
  return <span className={STYLES[role]}>{role}</span>;
}
