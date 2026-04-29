"use client";

import { useEffect, useState } from "react";
import {
  submitAnalysis,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type AnalyticsErrorResponse,
} from "@/lib/analytics";
import { ResultPanel } from "@/components/ResultPanel";

// ─── Form validation ──────────────────────────────────────────────────────────

interface FormErrors {
  address?: string;
  network?: string;
  depth?: string;
  tx_limit?: string;
  period_days?: string;
}

interface NetworkOption {
  code: string;
  name: string;
}

function validateForm(f: AnalyzeRequest & { period_days_raw: string }): FormErrors {
  const errors: FormErrors = {};
  if (!f.address || f.address.trim().length < 10) {
    errors.address = "Address must be at least 10 characters.";
  } else if (f.address.trim().length > 128) {
    errors.address = "Address must be at most 128 characters.";
  }
  if (!f.network) {
    errors.network = "Select a network.";
  }
  if (f.depth < 1 || f.depth > 5) {
    errors.depth = "Depth must be between 1 and 5.";
  }
  if (f.tx_limit < 1 || f.tx_limit > 200) {
    errors.tx_limit = "Transaction limit must be between 1 and 200.";
  }
  if (f.period_days_raw !== "") {
    const n = Number(f.period_days_raw);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      errors.period_days = "Period must be between 1 and 3650 days.";
    }
  }
  return errors;
}

// ─── Error UI mapping ─────────────────────────────────────────────────────────
// UI behavior is determined by error_code, never by the detail string.

interface ErrorDisplay {
  kind: "form-address" | "form-network" | "banner-warning" | "banner-error";
  message: string;
}

function mapErrorCode(err: AnalyticsErrorResponse): ErrorDisplay {
  switch (err.error_code) {
    case "INVALID_ADDRESS":
      return { kind: "form-address", message: "Invalid address for the selected network." };
    case "UNSUPPORTED_NETWORK":
      return { kind: "form-network", message: "This network is not supported." };
    case "BLOCKCHAIN_RATE_LIMITED":
      return {
        kind: "banner-warning",
        message: "Data provider is rate-limiting — please wait and retry.",
      };
    case "BLOCKCHAIN_UNAVAILABLE":
      return {
        kind: "banner-warning",
        message: "Blockchain data is temporarily unavailable — try again later.",
      };
    case "INVALID_REQUEST":
    case "INTERNAL_ERROR":
    default:
      return { kind: "banner-error", message: "Something went wrong. Please try again." };
  }
}

// ─── Adapter: AnalyzeResponse → ResultData ────────────────────────────────────
// AnalyzeResponse uses network: string; ResultPanel.ResultData uses network: string — compatible.

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnalyzePage() {
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState("");
  const [networks, setNetworks] = useState<NetworkOption[]>([]);
  const [networksLoading, setNetworksLoading] = useState(true);
  const [depth, setDepth] = useState(2);
  const [txLimit, setTxLimit] = useState(10);
  const [periodDaysRaw, setPeriodDaysRaw] = useState("");

  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [bannerError, setBannerError] = useState<{ kind: "warning" | "error"; message: string } | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchNetworks() {
      setNetworksLoading(true);
      try {
        const res = await fetch("/api/networks");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: NetworkOption[] = await res.json();
        if (cancelled) return;

        setNetworks(data);
        setNetwork((current) => {
          if (current && data.some((n) => n.code === current)) return current;
          return data[0]?.code ?? "";
        });
        if (data.length === 0) {
          setBannerError({ kind: "error", message: "No active networks are available." });
        }
      } catch {
        if (!cancelled) {
          setBannerError({ kind: "error", message: "Unable to load active networks." });
        }
      } finally {
        if (!cancelled) setNetworksLoading(false);
      }
    }

    fetchNetworks();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBannerError(null);
    setResult(null);

    const req: AnalyzeRequest & { period_days_raw: string } = {
      address: address.trim(),
      network,
      depth,
      tx_limit: txLimit,
      period_days: periodDaysRaw !== "" ? Number(periodDaysRaw) : null,
      period_days_raw: periodDaysRaw,
    };

    const errors = validateForm(req);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    const payload: AnalyzeRequest = {
      address: req.address,
      network: req.network,
      depth: req.depth,
      tx_limit: req.tx_limit,
      period_days: req.period_days,
    };

    setLoading(true);
    const outcome = await submitAnalysis(payload);
    setLoading(false);

    if (outcome.ok) {
      setResult(outcome.data);
    } else {
      const display = mapErrorCode(outcome.error);
      if (display.kind === "form-address") {
        setFormErrors({ address: display.message });
      } else if (display.kind === "form-network") {
        setFormErrors({ network: display.message });
      } else {
        setBannerError({
          kind: display.kind === "banner-warning" ? "warning" : "error",
          message: display.message,
        });
      }
    }
  }

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem", fontSize: "1.5rem" }}>Analyze Address</h1>

      {bannerError && (
        <div className={`alert ${bannerError.kind}`}>{bannerError.message}</div>
      )}

      <div className="card">
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-grid">
            <div className="form-group full">
              <label htmlFor="address">Address</label>
              <input
                id="address"
                type="text"
                placeholder="e.g. 1BoatSLRHtKNngkdXEeobR76b53LETtpyT"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {formErrors.address && (
                <span className="field-error">{formErrors.address}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="network">Network</label>
              <select
                id="network"
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                disabled={networksLoading || networks.length === 0}
              >
                {networksLoading && <option value="">Loading networks…</option>}
                {!networksLoading && networks.length === 0 && (
                  <option value="">No active networks</option>
                )}
                {networks.map((n) => (
                  <option key={n.code} value={n.code}>
                    {n.code} — {n.name}
                  </option>
                ))}
              </select>
              {formErrors.network && (
                <span className="field-error">{formErrors.network}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="depth">Depth (1–5)</label>
              <input
                id="depth"
                type="number"
                min={1}
                max={5}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              />
              {formErrors.depth && (
                <span className="field-error">{formErrors.depth}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="tx_limit">Transaction limit (1–200)</label>
              <input
                id="tx_limit"
                type="number"
                min={1}
                max={200}
                value={txLimit}
                onChange={(e) => setTxLimit(Number(e.target.value))}
              />
              {formErrors.tx_limit && (
                <span className="field-error">{formErrors.tx_limit}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="period_days">Period (days, optional)</label>
              <input
                id="period_days"
                type="number"
                min={1}
                max={3650}
                placeholder="leave blank for all time"
                value={periodDaysRaw}
                onChange={(e) => setPeriodDaysRaw(e.target.value)}
              />
              {formErrors.period_days && (
                <span className="field-error">{formErrors.period_days}</span>
              )}
            </div>
          </div>

          <div style={{ marginTop: "1.25rem" }}>
            <button
              type="submit"
              className="btn"
              disabled={loading || networksLoading || networks.length === 0}
            >
              {loading && <span className="spinner" />}
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </form>
      </div>

      {result && <ResultPanel result={result} />}
    </div>
  );
}
