import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { hasRequiredRole } from "@/lib/rbac";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const role = session.user.role;

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="muted-text">
          Signed in as {session.user.email} with {role} access.
        </p>
      </div>

      <div className="menu-grid">
        <Link className="menu-item" href="/analyze">
          <span className="menu-title">Run analysis</span>
          <span className="menu-desc">Score a blockchain address for risk signals.</span>
        </Link>

        {hasRequiredRole(role, "moderator") && (
          <Link className="menu-item" href="/moderator">
            <span className="menu-title">Moderator tools</span>
            <span className="menu-desc">Placeholder for future flagged-address workflows.</span>
          </Link>
        )}

        {hasRequiredRole(role, "admin") && (
          <Link className="menu-item" href="/admin">
            <span className="menu-title">Admin tools</span>
            <span className="menu-desc">Placeholder for future administration workflows.</span>
          </Link>
        )}
      </div>
    </div>
  );
}
