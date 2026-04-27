"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { use } from "react";
import { ResultPanel, type ResultData } from "@/components/ResultPanel";

export default function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [result, setResult] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history/${id}`);
      if (res.status === 404) {
        setError("Analysis not found.");
        return;
      }
      if (res.status === 403 || res.status === 401) {
        setError("You do not have permission to view this analysis.");
        return;
      }
      if (!res.ok) {
        setError("Failed to load analysis.");
        return;
      }
      const json = await res.json();
      setResult(json as ResultData);
    } catch {
      setError("Failed to load analysis.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  function handleExport() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analysis-${result.address}-${result.network}-${result.result_id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="page-header" style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/history" style={{ color: "var(--color-accent)", fontSize: "0.9rem" }}>
          ← History
        </Link>
        <h1 style={{ flex: 1 }}>Analysis Detail</h1>
        {result && (
          <button className="btn" onClick={handleExport} style={{ fontSize: "0.85rem" }}>
            Export JSON
          </button>
        )}
      </div>

      {loading && (
        <div className="card" style={{ textAlign: "center", color: "var(--color-muted)" }}>
          Loading…
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {result && <ResultPanel result={result} />}
    </div>
  );
}
