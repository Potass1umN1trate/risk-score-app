"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface AuditLogItem {
  id: string;
  user_id: string | null;
  user_email: string | null;
  actor_role: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details_json: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_LIMIT = 20;

const KNOWN_ACTIONS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
  "OAUTH_LOGIN_SUCCESS",
  "USER_REGISTERED",
  "USER_CREATED",
  "USER_ROLE_CHANGED",
  "USER_BLOCKED",
  "USER_UNBLOCKED",
  "USER_DELETED",
  "NETWORK_CONFIG_CHANGED",
  "RUN_ANALYSIS",
  "FLAGGED_ADDRESS_CREATED",
  "FLAGGED_ADDRESS_UPDATED",
  "FLAGGED_ADDRESS_DEACTIVATED",
  "FLAGGED_ADDRESS_IMPORT",
  "FLAGGED_ADDRESS_EXPORT",
];

const ROLES = ["user", "moderator", "admin"] as const;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB");
}

function visibleDetailsEntries(details: Record<string, unknown> | null): Array<[string, unknown]> {
  if (!details) return [];
  return Object.entries(details)
    .filter(([k]) => k !== "role");
}

function renderDetails(details: Record<string, unknown> | null): string {
  return visibleDetailsEntries(details)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");
}

function detailsTitle(details: Record<string, unknown> | null): string {
  return JSON.stringify(Object.fromEntries(visibleDetailsEntries(details)), null, 2);
}

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchLogs = useCallback(async (p: number, filters: {
    email: string; role: string; action: string; dateFrom: string; dateTo: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_LIMIT) });
      if (filters.email) params.set("email", filters.email);
      if (filters.role) params.set("role", filters.role);
      if (filters.action) params.set("action", filters.action);
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to load audit logs.");
        return;
      }
      const json: AuditLogResponse = await res.json();
      setData(json);
    } catch {
      setError("Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(page, { email, role, action, dateFrom, dateTo });
  }, [fetchLogs, page]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters() {
    setPage(1);
    fetchLogs(1, { email, role, action, dateFrom, dateTo });
  }

  function clearFilters() {
    setEmail("");
    setRole("");
    setAction("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    fetchLogs(1, { email: "", role: "", action: "", dateFrom: "", dateTo: "" });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_LIMIT)) : 1;
  const hasActiveFilters = email || role || action || dateFrom || dateTo;

  return (
    <div>
      <div className="page-header">
        <h1>Audit log</h1>
        <p className="muted-text">
          {data
            ? `${data.total} total ${data.total === 1 ? "event" : "events"}`
            : "User and admin action history."}
        </p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <Link href="/admin" style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
          ← Admin tools
        </Link>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ marginBottom: "1rem", padding: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
              User email
            </label>
            <input
              className="input"
              type="text"
              placeholder="Search email…"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
              Role
            </label>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box" }}
            >
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
              Event type
            </label>
            <select
              className="input"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box" }}
            >
              <option value="">All events</option>
              {KNOWN_ACTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
              From date
            </label>
            <input
              className="input"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
              To date
            </label>
            <input
              className="input"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn btn-primary" onClick={applyFilters} disabled={loading} style={{ flex: 1 }}>
              Apply
            </button>
            {hasActiveFilters && (
              <button className="btn" onClick={clearFilters} disabled={loading} title="Clear filters">
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading && !data && (
        <div className="card" style={{ textAlign: "center", color: "var(--color-muted)" }}>
          Loading…
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="card" style={{ color: "var(--color-muted)" }}>
          No audit events found{hasActiveFilters ? " matching the current filters" : ""}. Events are recorded after user and admin actions are performed.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="tbl-wrap card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--color-muted)", fontSize: "0.85rem" }}>
                      {formatDate(item.created_at)}
                    </td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--color-muted)", fontSize: "0.85rem" }}>
                      {formatTime(item.created_at)}
                    </td>
                    <td style={{ fontSize: "0.85rem" }}>
                      {item.user_email ?? item.user_id ?? <span style={{ color: "var(--color-muted)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: "0.85rem", color: item.actor_role ? "inherit" : "var(--color-muted)" }}>
                      {item.actor_role ?? "—"}
                    </td>
                    <td>
                      <span style={{
                        fontFamily: "monospace",
                        fontSize: "0.82rem",
                        background: "var(--color-surface)",
                        padding: "0.1rem 0.4rem",
                        borderRadius: "4px",
                        border: "1px solid var(--color-border)",
                      }}>
                        {item.action}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
                      {item.entity ? (
                        <>
                          <span>{item.entity}</span>
                          {item.entity_id && (
                            <span
                              className="mono"
                              style={{ display: "block", fontSize: "0.78rem", opacity: 0.7 }}
                              title={item.entity_id}
                            >
                              {item.entity_id.length > 16
                                ? `${item.entity_id.slice(0, 8)}…`
                                : item.entity_id}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "var(--color-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.80rem", color: "var(--color-muted)", maxWidth: "24ch" }}>
                      {item.details_json && renderDetails(item.details_json) ? (
                        <span title={detailsTitle(item.details_json)}>
                          {renderDetails(item.details_json)}
                        </span>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem", justifyContent: "center" }}>
              <button
                className="btn"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                style={{ padding: "0.3rem 0.8rem" }}
              >
                ← Prev
              </button>
              <span style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                style={{ padding: "0.3rem 0.8rem" }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
