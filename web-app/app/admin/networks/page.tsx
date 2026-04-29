"use client";

import { useEffect, useState } from "react";

interface NetworkItem {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  default_depth: number;
  max_depth: number;
  default_tx_limit: number;
  max_tx_limit: number;
  default_period_days: number | null;
  max_period_days: number;
}

type LimitField =
  | "default_depth"
  | "max_depth"
  | "default_tx_limit"
  | "max_tx_limit"
  | "default_period_days"
  | "max_period_days";

type LimitDraft = Record<LimitField, string>;

const LIMIT_FIELDS: LimitField[] = [
  "default_depth",
  "max_depth",
  "default_tx_limit",
  "max_tx_limit",
  "default_period_days",
  "max_period_days",
];

function draftFromNetwork(network: NetworkItem): LimitDraft {
  return {
    default_depth: String(network.default_depth),
    max_depth: String(network.max_depth),
    default_tx_limit: String(network.default_tx_limit),
    max_tx_limit: String(network.max_tx_limit),
    default_period_days:
      network.default_period_days === null ? "" : String(network.default_period_days),
    max_period_days: String(network.max_period_days),
  };
}

export default function AdminNetworksPage() {
  const [networks, setNetworks] = useState<NetworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingCode, setUpdatingCode] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LimitDraft>>({});

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
      setDrafts(Object.fromEntries(data.map((network) => [network.code, draftFromNetwork(network)])));
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

      const updated: NetworkItem = await res.json();
      setNetworks((items) =>
        items.map((item) => (item.code === network.code ? updated : item))
      );
      setDrafts((items) => ({ ...items, [updated.code]: draftFromNetwork(updated) }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update network");
    } finally {
      setUpdatingCode(null);
    }
  }

  function handleDraftChange(code: string, field: LimitField, value: string) {
    setDrafts((items) => ({
      ...items,
      [code]: {
        ...items[code],
        [field]: value,
      },
    }));
  }

  function buildLimitPatch(network: NetworkItem): Record<string, number | null> | null {
    const draft = drafts[network.code];
    if (!draft) return null;

    const patch: Record<string, number | null> = {};
    for (const field of LIMIT_FIELDS) {
      const raw = draft[field].trim();
      if (field === "default_period_days" && raw === "") {
        if (network.default_period_days !== null) patch[field] = null;
        continue;
      }

      const value = Number(raw);
      if (!Number.isInteger(value)) {
        throw new Error(`${field} must be an integer${field === "default_period_days" ? " or blank" : ""}`);
      }

      if (value !== network[field]) {
        patch[field] = value;
      }
    }

    return Object.keys(patch).length > 0 ? patch : null;
  }

  async function handleSaveLimits(network: NetworkItem) {
    setActionError(null);
    setUpdatingCode(network.code);

    try {
      const patch = buildLimitPatch(network);
      if (!patch) return;

      const res = await fetch(`/api/admin/networks/${network.code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update network limits");
      }

      const updated: NetworkItem = await res.json();
      setNetworks((items) =>
        items.map((item) => (item.code === network.code ? updated : item))
      );
      setDrafts((items) => ({ ...items, [updated.code]: draftFromNetwork(updated) }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update network limits");
    } finally {
      setUpdatingCode(null);
    }
  }

  function hasLimitChanges(network: NetworkItem): boolean {
    const draft = drafts[network.code];
    if (!draft) return false;
    return LIMIT_FIELDS.some((field) => {
      if (field === "default_period_days") {
        return draft[field].trim() !== (network.default_period_days === null ? "" : String(network.default_period_days));
      }
      return draft[field].trim() !== String(network[field]);
    });
  }

  return (
    <div>
      <div className="page-header">
        <h1>Network management</h1>
        <p className="muted-text">
          Configure availability and per-network analysis limits for new analyses.
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
                <th>Depth default/max</th>
                <th>Tx default/max</th>
                <th>Period default/max</th>
                <th>Limits</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((network) => {
                const draft = drafts[network.code] ?? draftFromNetwork(network);
                const disabled = updatingCode === network.code;
                return (
                  <tr key={network.id}>
                    <td>{network.code}</td>
                    <td>{network.name}</td>
                    <td>
                      <span style={{ color: network.is_active ? "var(--color-low)" : "var(--color-muted)" }}>
                        {network.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <input
                          aria-label={`${network.code} default depth`}
                          type="number"
                          min={1}
                          value={draft.default_depth}
                          disabled={disabled}
                          onChange={(e) => handleDraftChange(network.code, "default_depth", e.target.value)}
                          style={{ width: "4.5rem" }}
                        />
                        <input
                          aria-label={`${network.code} max depth`}
                          type="number"
                          min={1}
                          value={draft.max_depth}
                          disabled={disabled}
                          onChange={(e) => handleDraftChange(network.code, "max_depth", e.target.value)}
                          style={{ width: "4.5rem" }}
                        />
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <input
                          aria-label={`${network.code} default transaction limit`}
                          type="number"
                          min={1}
                          value={draft.default_tx_limit}
                          disabled={disabled}
                          onChange={(e) => handleDraftChange(network.code, "default_tx_limit", e.target.value)}
                          style={{ width: "5.5rem" }}
                        />
                        <input
                          aria-label={`${network.code} max transaction limit`}
                          type="number"
                          min={1}
                          value={draft.max_tx_limit}
                          disabled={disabled}
                          onChange={(e) => handleDraftChange(network.code, "max_tx_limit", e.target.value)}
                          style={{ width: "5.5rem" }}
                        />
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <input
                          aria-label={`${network.code} default period days`}
                          type="number"
                          min={1}
                          placeholder="all"
                          value={draft.default_period_days}
                          disabled={disabled}
                          onChange={(e) => handleDraftChange(network.code, "default_period_days", e.target.value)}
                          style={{ width: "5.5rem" }}
                        />
                        <input
                          aria-label={`${network.code} max period days`}
                          type="number"
                          min={1}
                          value={draft.max_period_days}
                          disabled={disabled}
                          onChange={(e) => handleDraftChange(network.code, "max_period_days", e.target.value)}
                          style={{ width: "5.5rem" }}
                        />
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
                        disabled={disabled || !hasLimitChanges(network)}
                        onClick={() => handleSaveLimits(network)}
                      >
                        Save
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
                        disabled={disabled}
                        onClick={() => handleToggle(network)}
                      >
                        {network.is_active ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
