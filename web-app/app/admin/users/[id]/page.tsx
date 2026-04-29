"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserRoleBadge } from "@/components/UserRoleBadge";
import { BlockedBadge } from "@/components/BlockedBadge";
import type { Role } from "@/lib/rbac";

interface UserDetail {
  id: string;
  email: string;
  role: Role;
  isBlocked: boolean;
  createdAt: string;
  hasPassword: boolean;
  hasOAuth: boolean;
  oauthProviders: string[];
}

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newRole, setNewRole] = useState<Role>("user");
  const [roleSubmitting, setRoleSubmitting] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleSuccess, setRoleSuccess] = useState(false);

  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/users/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<UserDetail>;
      })
      .then((data) => {
        setUser(data);
        setNewRole(data.role);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load user"))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleRoleChange(e: React.FormEvent) {
    e.preventDefault();
    setRoleError(null);
    setRoleSuccess(false);
    setRoleSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRoleError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setUser(body as UserDetail);
      setRoleSuccess(true);
    } finally {
      setRoleSubmitting(false);
    }
  }

  async function handleToggleBlocked() {
    if (!user) return;
    setBlockError(null);
    setBlockSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBlocked: !user.isBlocked }),
      });
      const body = await res.json();
      if (!res.ok) {
        setBlockError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setUser(body as UserDetail);
    } finally {
      setBlockSubmitting(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleteSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleteError(body.error ?? `HTTP ${res.status}`);
        setDeleteConfirm(false);
        return;
      }
      router.push("/admin/users");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  if (loading) return <p className="muted-text">Loading…</p>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!user) return <div className="error-banner">User not found.</div>;

  return (
    <div style={{ maxWidth: "520px" }}>
      <div className="page-header">
        <Link href="/admin/users" className="muted-text" style={{ fontSize: "0.85rem" }}>
          ← Users
        </Link>
        <h1 style={{ marginTop: "0.5rem" }}>{user.email}</h1>
        <p className="muted-text">
          User ID: <code>{user.id}</code> &nbsp;·&nbsp;
          Created: {new Date(user.createdAt).toLocaleString()}
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", alignItems: "center" }}>
        <UserRoleBadge role={user.role} />
        <BlockedBadge isBlocked={user.isBlocked} />
        {user.hasPassword && <span className="badge badge-user">password</span>}
        {user.hasOAuth && (
          <span className="badge badge-user">OAuth: {user.oauthProviders.join(", ")}</span>
        )}
      </div>

      {/* Change role */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Change role</h2>
        <form onSubmit={handleRoleChange} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
          <div className="form-group" style={{ margin: 0, flex: "0 1 160px" }}>
            <select className="form-input" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              <option value="user">user</option>
              <option value="moderator">moderator</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={roleSubmitting || newRole === user.role}>
            {roleSubmitting ? "Saving…" : "Save role"}
          </button>
        </form>
        {roleError && <p className="field-error" style={{ marginTop: "0.5rem" }}>{roleError}</p>}
        {roleSuccess && <p style={{ marginTop: "0.5rem", color: "#86efac", fontSize: "0.85rem" }}>Role updated.</p>}
      </section>

      {/* Block/unblock */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
          {user.isBlocked ? "Unblock user" : "Block user"}
        </h2>
        <p className="muted-text" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
          {user.isBlocked
            ? "Unblocking will allow this user to sign in again."
            : "Blocking will immediately prevent sign-in. Existing sessions expire on next token check."}
        </p>
        <button
          className="btn btn-secondary"
          disabled={blockSubmitting}
          onClick={handleToggleBlocked}
        >
          {blockSubmitting ? "Saving…" : user.isBlocked ? "Unblock" : "Block"}
        </button>
        {blockError && <p className="field-error" style={{ marginTop: "0.5rem" }}>{blockError}</p>}
      </section>

      {/* Delete */}
      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#fca5a5" }}>Delete user</h2>
        <p className="muted-text" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
          Permanently removes the account. Analysis history is preserved but ownership is lost.
        </p>
        <button
          className="btn btn-secondary"
          style={{ color: "#fca5a5" }}
          onClick={() => setDeleteConfirm(true)}
        >
          Delete user
        </button>
        {deleteError && <p className="field-error" style={{ marginTop: "0.5rem" }}>{deleteError}</p>}
      </section>

      {deleteConfirm && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
          }}
          onClick={() => !deleteSubmitting && setDeleteConfirm(false)}
        >
          <div
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "0.5rem", padding: "1.5rem", maxWidth: "360px", width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ marginBottom: "1rem" }}>
              Permanently delete <strong>{user.email}</strong>? This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" disabled={deleteSubmitting} onClick={() => setDeleteConfirm(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: "#7f1d1d", borderColor: "#7f1d1d" }}
                disabled={deleteSubmitting}
                onClick={handleDelete}
              >
                {deleteSubmitting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
