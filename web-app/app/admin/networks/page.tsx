"use client";

import { useEffect, useState } from "react";

interface NetworkItem {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
}

export default function AdminNetworksPage() {
  const [networks, setNetworks] = useState<NetworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingCode, setUpdatingCode] = useState<string | null>(null);

  async function fetchNetworks() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/networks");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data: NetworkItem[] = await res.json();
      setNetworks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load networks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNetworks();
  }, []);

  async function handleToggle(network: NetworkItem) {
    setActionError(null);
    setUpdatingCode(network.code);

    try {
      const res = await fetch(`/api/admin/networks/${network.code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !network.is_active }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update network");
      }

      setNetworks((items) =>
        items.map((item) =>
          item.code === network.code
            ? { ...item, is_active: !network.is_active }
            : item
        )
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update network");
    } finally {
      setUpdatingCode(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Network management</h1>
        <p className="muted-text">
          Disabled networks remain visible in history but cannot be selected for new analyses.
        </p>
      </div>

      {actionError && (
        <div className="error-banner" style={{ marginBottom: "1rem" }}>{actionError}</div>
      )}

      {loading ? (
        <p className="muted-text">Loading…</p>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : networks.length === 0 ? (
        <p className="muted-text">No networks found.</p>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((network) => (
                <tr key={network.id}>
                  <td>{network.code}</td>
                  <td>{network.name}</td>
                  <td>
                    <span style={{ color: network.is_active ? "var(--color-low)" : "var(--color-muted)" }}>
                      {network.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
                      disabled={updatingCode === network.code}
                      onClick={() => handleToggle(network)}
                    >
                      {network.is_active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
