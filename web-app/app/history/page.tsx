"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { RiskBadge } from "@/components/ResultPanel";

interface HistoryItem {
  request_id: string;
  result_id: string;
  address: string;
  network_code: string;
  risk_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  scoring_method: string;
  model_version: string;
  status: string;
  analyzed_at: string;
  user_id: string | null;
  user_email: string | null;
}

interface HistoryResponse {
  items: HistoryItem[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_LIMIT = 20;

export default function HistoryPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history?page=${p}&limit=${PAGE_LIMIT}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to load history.");
        return;
      }
      const json: HistoryResponse = await res.json();
      setData(json);
    } catch {
      setError("Failed to load history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory(page);
  }, [fetchHistory, page]);

  const totalPages = data ? Math.ceil(data.total / PAGE_LIMIT) : 1;

  return (
    <div>
      <div className="page-header">
        <h1>Analysis History</h1>
        {data && (
          <p className="muted-text">{data.total} total {data.total === 1 ? "analysis" : "analyses"}</p>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading && !data && (
        <div className="card" style={{ textAlign: "center", color: "var(--color-muted)" }}>
          Loading…
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="card" style={{ color: "var(--color-muted)" }}>
          No analyses found.{" "}
          <Link href="/analyze" style={{ color: "var(--color-accent)" }}>
            Run your first analysis
          </Link>
          .
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="tbl-wrap card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Network</th>
                  <th>Risk score</th>
                  <th>Risk level</th>
                  <th>Analyzed at</th>
                  {data.items.some((i) => i.user_email) && <th>User</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.result_id}>
                    <td className="mono" style={{ maxWidth: "18ch", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.address.slice(0, 8)}…{item.address.slice(-6)}
                    </td>
                    <td>{item.network_code}</td>
                    <td style={{ fontWeight: 600 }}>{item.risk_score.toFixed(2)}</td>
                    <td><RiskBadge level={item.risk_level} /></td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--color-muted)", fontSize: "0.85rem" }}>
                      {new Date(item.analyzed_at).toLocaleString()}
                    </td>
                    {data.items.some((i) => i.user_email) && (
                      <td style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
                        {item.user_email ?? "—"}
                      </td>
                    )}
                    <td>
                      <Link
                        href={`/history/${item.result_id}`}
                        className="btn"
                        style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
                      >
                        View
                      </Link>
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
