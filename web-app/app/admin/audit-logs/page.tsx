"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface AuditLogItem {
  id: string;
  user_id: string | null;
  user_email: string | null;
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB"); // HH:MM:SS
}

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audit-logs?page=${p}&limit=${PAGE_LIMIT}`);
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
    fetchLogs(page);
  }, [fetchLogs, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_LIMIT)) : 1;

  return (
    <div>
      <div className="page-header">
        <h1>Audit log</h1>
        <p className="muted-text">
          {data ? `${data.total} total ${data.total === 1 ? "event" : "events"}` : "Admin action history."}
        </p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <Link href="/admin" style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
          ← Admin tools
        </Link>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading && !data && (
        <div className="card" style={{ textAlign: "center", color: "var(--color-muted)" }}>
          Loading…
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="card" style={{ color: "var(--color-muted)" }}>
          No audit events recorded yet. Events will appear here after admin actions are performed.
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
                      {item.details_json ? (
                        <span title={JSON.stringify(item.details_json, null, 2)}>
                          {Object.entries(item.details_json)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(", ")}
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
