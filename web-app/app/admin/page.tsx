import Link from "next/link";

export default function AdminPage() {
  return (
    <div>
      <div className="page-header">
        <h1>Admin tools</h1>
        <p className="muted-text">Administration area — manage users, review audit logs, and configure system settings.</p>
      </div>

      <div className="menu-grid">
        <Link className="menu-item" href="/admin/users">
          <span className="menu-title">User management</span>
          <span className="menu-desc">View, create, edit roles, block, and delete user accounts.</span>
        </Link>
      </div>
    </div>
  );
}
