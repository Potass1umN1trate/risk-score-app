"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

interface FlaggedAddressItem {
  id: string;
  network_code: string;
  network_name: string;
  address: string;
  risk_category_code: string;
  risk_category_name: string;
  comment: string | null;
  created_by_email: string | null;
  created_at: string;
  is_active: boolean;
}

interface ListResponse {
  items: FlaggedAddressItem[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_LIMIT = 20;

const NETWORKS = ["BTC", "ETH", "TRX", "SOL", "BNB", "XRP", "LTC", "DOGE", "ADA", "TON"];
const CATEGORIES = ["sanctions", "mixer", "scam", "darknet_market", "ransomware", "phishing", "gambling", "exchange", "suspicious"];

function CategoryBadge({ code }: { code: string }) {
  const colors: Record<string, string> = {
    sanctions: "var(--color-severity-high)",
    ransomware: "var(--color-severity-high)",
    darknet_market: "var(--color-severity-high)",
    mixer: "var(--color-severity-medium)",
    scam: "var(--color-severity-medium)",
    phishing: "var(--color-severity-medium)",
    suspicious: "var(--color-severity-medium)",
    gambling: "var(--color-severity-low)",
    exchange: "var(--color-severity-low)",
  };
  const textColors: Record<string, string> = {
    sanctions: "var(--color-severity-high-text)",
    ransomware: "var(--color-severity-high-text)",
    darknet_market: "var(--color-severity-high-text)",
    mixer: "var(--color-severity-medium-text)",
    scam: "var(--color-severity-medium-text)",
    phishing: "var(--color-severity-medium-text)",
    suspicious: "var(--color-severity-medium-text)",
    gambling: "var(--color-severity-low-text)",
    exchange: "var(--color-severity-low-text)",
  };
  return (
    <span
      className="risk-badge"
      style={{
        background: colors[code] ?? "var(--color-border)",
        color: textColors[code] ?? "var(--color-text)",
      }}
    >
      {code.replace(/_/g, " ")}
    </span>
  );
}

export default function FlaggedAddressesPage() {
  const [page, setPage] = useState(1);
  const [network, setNetwork] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("true");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildUrl = useCallback((p: number) => {
    const params = new URLSearchParams();
    params.set("page", String(p));
    params.set("limit", String(PAGE_LIMIT));
    if (network) params.set("network", network);
    if (category) params.set("category", category);
    if (search) params.set("search", search);
    if (activeFilter) params.set("active", activeFilter);
    return `/api/flagged-addresses?${params.toString()}`;
  }, [network, category, search, activeFilter]);

  const fetchList = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(p));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to load records.");
        return;
      }
      setData(await res.json());
    } catch {
      setError("Failed to load records.");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    fetchList(page);
  }, [fetchList, page]);

  // Reset to page 1 on filter change
  useEffect(() => {
    setPage(1);
  }, [network, category, search, activeFilter]);

  const totalPages = data ? Math.ceil(data.total / PAGE_LIMIT) : 1;

  async function handleDeactivate(id: string) {
    if (!confirm("Deactivate this flagged address?")) return;
    setDeactivating(id);
    try {
      const res = await fetch(`/api/flagged-addresses/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert((body as { error?: string }).error ?? "Failed to deactivate.");
        return;
      }
      fetchList(page);
    } catch {
      alert("Failed to deactivate.");
    } finally {
      setDeactivating(null);
    }
  }

  async function handleExport(format: "json" | "csv") {
    try {
      const res = await fetch(`/api/flagged-addresses/export?format=${format}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert((body as { error?: string }).error ?? "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flagged-addresses.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed.");
    }
  }

  async function handleImport() {
    if (!importFile) return;
    setImportLoading(true);
    setImportStatus(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await fetch("/api/flagged-addresses/import", {
        method: "POST",
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportStatus(`Error: ${(body as { error?: string }).error ?? "Import failed."}`);
        return;
      }
      const result = body as { inserted: number; skipped: number; errors: string[] };
      const parts = [`Inserted: ${result.inserted}`, `Skipped (duplicates): ${result.skipped}`];
      if (result.errors.length > 0) parts.push(`Errors: ${result.errors.slice(0, 3).join("; ")}`);
      setImportStatus(parts.join(" · "));
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchList(1);
    } catch {
      setImportStatus("Import failed.");
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1>Flagged Addresses</h1>
          {data && (
            <p className="muted-text">{data.total} record{data.total !== 1 ? "s" : ""}</p>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={() => handleExport("json")} style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}>
            Export JSON
          </button>
          <button className="btn btn-secondary" onClick={() => handleExport("csv")} style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}>
            Export CSV
          </button>
          <button className="btn btn-secondary" onClick={() => setImportOpen((o) => !o)} style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}>
            {importOpen ? "Hide import" : "Import"}
          </button>
          <Link href="/flagged-addresses/new" className="btn" style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}>
            + Add
          </Link>
        </div>
      </div>

      {importOpen && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p className="section-title">Import records</p>
          <p style={{ fontSize: "0.85rem", color: "var(--color-muted)", marginBottom: "0.75rem" }}>
            Upload a JSON array or CSV file. Required columns: <code>network_code</code>, <code>address</code>, <code>risk_category_code</code>. Optional: <code>comment</code>.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv,text/csv,application/json"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              style={{ width: "auto", flex: 1 }}
            />
            <button
              className="btn"
              onClick={handleImport}
              disabled={!importFile || importLoading}
              style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}
            >
              {importLoading ? <><span className="spinner" />Importing…</> : "Upload"}
            </button>
          </div>
          {importStatus && (
            <p style={{ marginTop: "0.6rem", fontSize: "0.85rem", color: importStatus.startsWith("Error") ? "var(--color-high)" : "var(--color-low)" }}>
              {importStatus}
            </p>
          )}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          style={{ width: "auto", minWidth: "120px" }}
        >
          <option value="">All networks</option>
          {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ width: "auto", minWidth: "150px" }}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          style={{ width: "auto", minWidth: "110px" }}
        >
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
          <option value="">All</option>
        </select>
        <input
          type="search"
          placeholder="Search address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: "200px" }}
        />
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading && !data && (
        <div className="card" style={{ textAlign: "center", color: "var(--color-muted)" }}>Loading…</div>
      )}

      {data && data.items.length === 0 && (
        <div className="card" style={{ color: "var(--color-muted)" }}>
          No flagged addresses found.{" "}
          <Link href="/flagged-addresses/new" style={{ color: "var(--color-accent)" }}>Add one</Link>.
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
                  <th>Category</th>
                  <th>Comment</th>
                  <th>Created by</th>
                  <th>Created at</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.5 }}>
                    <td className="mono" style={{ maxWidth: "18ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.address.slice(0, 8)}…{item.address.slice(-6)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{item.network_code}</td>
                    <td><CategoryBadge code={item.risk_category_code} /></td>
                    <td style={{ maxWidth: "20ch", overflow: "hidden", textOverflow: "ellipsis", color: "var(--color-muted)", fontSize: "0.82rem" }}>
                      {item.comment ?? "—"}
                    </td>
                    <td style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
                      {item.created_by_email ?? "system"}
                    </td>
                    <td style={{ whiteSpace: "nowrap", color: "var(--color-muted)", fontSize: "0.82rem" }}>
                      {new Date(item.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <span style={{ fontSize: "0.78rem", color: item.is_active ? "var(--color-low)" : "var(--color-muted)" }}>
                        {item.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <Link
                          href={`/flagged-addresses/${item.id}`}
                          className="btn btn-secondary"
                          style={{ fontSize: "0.78rem", padding: "0.2rem 0.6rem" }}
                        >
                          Edit
                        </Link>
                        {item.is_active && (
                          <button
                            className="btn"
                            style={{ fontSize: "0.78rem", padding: "0.2rem 0.6rem", background: "var(--color-high)" }}
                            onClick={() => handleDeactivate(item.id)}
                            disabled={deactivating === item.id}
                          >
                            {deactivating === item.id ? "…" : "Deactivate"}
                          </button>
                        )}
                      </div>
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
