"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserRoleBadge } from "@/components/UserRoleBadge";
import { BlockedBadge } from "@/components/BlockedBadge";
import type { Role } from "@/lib/rbac";

interface UserItem {
  id: string;
  email: string;
  role: Role;
  isBlocked: boolean;
  createdAt: string;
  hasPassword: boolean;
  hasOAuth: boolean;
}

interface ListResponse {
  items: UserItem[];
  total: number;
  page: number;
  limit: number;
}

const LIMIT = 20;

export default function AdminUsersPage() {
  const router = useRouter();

  const [items, setItems] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [emailFilter, setEmailFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | Role>("");
  const [blockedFilter, setBlockedFilter] = useState<"" | "true" | "false">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchUsers = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
    if (emailFilter) params.set("email", emailFilter);
    if (roleFilter) params.set("role", roleFilter);
    if (blockedFilter) params.set("blocked", blockedFilter);

    try {
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data: ListResponse = await res.json();
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [emailFilter, roleFilter, blockedFilter]);

  useEffect(() => {
    fetchUsers(page);
  }, [fetchUsers, page]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchUsers(1);
  }

  async function handleToggleBlocked(user: UserItem) {
    setActionError(null);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBlocked: !user.isBlocked }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error ?? "Failed to update user");
      return;
    }
    fetchUsers(page);
  }

  async function handleDelete(id: string) {
    setActionError(null);
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error ?? "Failed to delete user");
      setDeleteConfirm(null);
      return;
    }
    setDeleteConfirm(null);
    fetchUsers(page);
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div>
      <div className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1>User management</h1>
          <p className="muted-text">{total} user{total !== 1 ? "s" : ""} total</p>
        </div>
        <Link href="/admin/users/new" className="btn btn-primary">+ New user</Link>
      </div>

      <form onSubmit={handleSearch} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem", alignItems: "flex-end" }}>
        <div className="form-group" style={{ margin: 0, flex: "1 1 180px" }}>
          <label className="form-label">Email</label>
          <input
            className="form-input"
            placeholder="Search by email…"
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
          />
        </div>
        <div className="form-group" style={{ margin: 0, flex: "0 1 140px" }}>
          <label className="form-label">Role</label>
          <select className="form-input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as "" | Role)}>
            <option value="">All roles</option>
            <option value="user">user</option>
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, flex: "0 1 140px" }}>
          <label className="form-label">Status</label>
          <select className="form-input" value={blockedFilter} onChange={(e) => setBlockedFilter(e.target.value as "" | "true" | "false")}>
            <option value="">All</option>
            <option value="false">Active</option>
            <option value="true">Blocked</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-end" }}>Filter</button>
      </form>

      {actionError && (
        <div className="error-banner" style={{ marginBottom: "1rem" }}>{actionError}</div>
      )}

      {loading ? (
        <p className="muted-text">Loading…</p>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : items.length === 0 ? (
        <p className="muted-text">No users found.</p>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Auth</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td><UserRoleBadge role={u.role} /></td>
                  <td><BlockedBadge isBlocked={u.isBlocked} /></td>
                  <td style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
                    {[u.hasPassword && "password", u.hasOAuth && "OAuth"].filter(Boolean).join(", ")}
                  </td>
                  <td style={{ fontSize: "0.75rem" }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
                      onClick={() => router.push(`/admin/users/${u.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
                      onClick={() => handleToggleBlocked(u)}
                    >
                      {u.isBlocked ? "Unblock" : "Block"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", color: "#fca5a5" }}
                      onClick={() => setDeleteConfirm(u.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "center" }}>
          <button
            className="btn btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span className="muted-text">Page {page} of {totalPages}</span>
          <button
            className="btn btn-secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}

      {deleteConfirm && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
          }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "0.5rem", padding: "1.5rem", maxWidth: "360px", width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ marginBottom: "1rem" }}>
              Permanently delete this user? This cannot be undone. Analysis history will be orphaned.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: "#7f1d1d", borderColor: "#7f1d1d" }}
                onClick={() => handleDelete(deleteConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
