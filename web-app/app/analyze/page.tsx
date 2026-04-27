"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  SUPPORTED_NETWORKS,
  submitAnalysis,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type AnalyticsErrorResponse,
  type RiskFactor,
} from "@/lib/analytics";

const TransactionGraph = dynamic(() => import("@/components/TransactionGraph"), { ssr: false });
const SankeyDiagram = dynamic(() => import("@/components/SankeyDiagram"), { ssr: false });

// ─── Form validation ──────────────────────────────────────────────────────────

interface FormErrors {
  address?: string;
  network?: string;
  depth?: string;
  tx_limit?: string;
  period_days?: string;
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: string }) {
  return <span className={`risk-badge ${level}`}>{level}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`risk-badge ${severity}`}>{severity}</span>;
}

function ScoreBar({ score, level }: { score: number; level: string }) {
  return (
    <div className="score-bar-wrap">
      <div
        className={`score-bar-fill ${level}`}
        style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
      />
    </div>
  );
}

function FactorList({ factors }: { factors: RiskFactor[] }) {
  if (factors.length === 0) {
    return <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>No risk factors identified.</p>;
  }
  return (
    <div className="factor-list">
      {factors.map((f, i) => (
        <div key={i} className={`factor-item ${f.severity}`}>
          <div className="factor-header">
            <SeverityBadge severity={f.severity} />
            <span className="factor-label">{f.label}</span>
            <span style={{ color: "var(--color-muted)", fontSize: "0.8rem", marginLeft: "auto" }}>
              {String(f.value)}
            </span>
          </div>
          <p className="factor-desc">{f.description}</p>
        </div>
      ))}
    </div>
  );
}

function NodesTable({ nodes }: { nodes: AnalyzeResponse["nodes"] }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Address</th>
            <th>Depth</th>
            <th>Root</th>
            <th>Flagged</th>
            <th>Flag Types</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n, i) => (
            <tr key={i}>
              <td className="mono">{n.address}</td>
              <td>{n.depth}</td>
              <td>{n.is_root ? "✓" : ""}</td>
              <td style={{ color: n.is_flagged ? "var(--color-high)" : undefined }}>
                {n.is_flagged ? "Yes" : ""}
              </td>
              <td>{n.flag_types.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTs(ts: number | null): string {
  if (ts === null) return "—";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function EdgesTable({ edges }: { edges: AnalyzeResponse["edges"] }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Tx count</th>
            <th>Total amount</th>
            <th>First seen</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e, i) => (
            <tr key={i}>
              <td className="mono">{e.from_address}</td>
              <td className="mono">{e.to_address}</td>
              <td>{e.tx_count}</td>
              <td>{e.total_amount.toFixed(8)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{formatTs(e.first_seen)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{formatTs(e.last_seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeaturesTable({ features }: { features: Record<string, number> }) {
  const entries = Object.entries(features);
  if (entries.length === 0) return null;
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td className="mono">{k}</td>
              <td>{typeof v === "number" ? v.toFixed(6) : String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Result panel ─────────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: AnalyzeResponse }) {
  const hasFeatures = Object.keys(result.features).length > 0;

  return (
    <div>
      {/* Score summary */}
      <div className="card">
        <div className="stat-row" style={{ marginBottom: "1rem" }}>
          <div className="stat-item">
            <label>Risk score</label>
            <span className="val" style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {result.risk_score.toFixed(2)}
            </span>
          </div>
          <div className="stat-item">
            <label>Risk level</label>
            <RiskBadge level={result.risk_level} />
          </div>
          <div className="stat-item">
            <label>Scoring method</label>
            <span className="val">{result.scoring_method}</span>
          </div>
          <div className="stat-item">
            <label>Model version</label>
            <span className="val mono" style={{ fontSize: "0.82rem" }}>{result.model_version}</span>
          </div>
          {result.flag_type && (
            <div className="stat-item">
              <label>Flag type</label>
              <span className="val">{result.flag_type}</span>
            </div>
          )}
          <div className="stat-item">
            <label>Nodes / Edges</label>
            <span className="val">{result.nodes_count} / {result.edges_count}</span>
          </div>
          <div className="stat-item" style={{ gridColumn: "1 / -1" }}>
            <label>Address ({result.network})</label>
            <span className="val mono">{result.address}</span>
          </div>
        </div>
        <ScoreBar score={result.risk_score} level={result.risk_level} />
        <p style={{ fontSize: "0.78rem", color: "var(--color-muted)", marginTop: "0.5rem" }}>
          Analyzed at {new Date(result.analyzed_at).toLocaleString()}
        </p>
      </div>

      {/* Risk factors */}
      <div className="card">
        <p className="section-title">Risk factors</p>
        <FactorList factors={result.factors} />
      </div>

      {/* Nodes */}
      {result.nodes.length > 0 && (
        <div className="card">
          <p className="section-title">Nodes ({result.nodes_count})</p>
          <NodesTable nodes={result.nodes} />
        </div>
      )}

      {/* Edges */}
      {result.edges.length > 0 && (
        <div className="card">
          <p className="section-title">Edges ({result.edges_count})</p>
          <EdgesTable edges={result.edges} />
        </div>
      )}

      {/* Transaction Graph */}
      <div className="card">
        <p className="section-title">Transaction Graph</p>
        {result.edges.length === 0 ? (
          <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
            No transaction edges found — visualization is not available.
          </p>
        ) : (
          <TransactionGraph
            nodes={result.nodes}
            edges={result.edges}
            rootAddress={result.address}
          />
        )}
      </div>

      {/* Sankey Diagram */}
      <div className="card">
        <p className="section-title">Transaction Flow</p>
        {result.edges.length === 0 ? (
          <p style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>
            No transaction edges found — visualization is not available.
          </p>
        ) : (
          <SankeyDiagram
            edges={result.edges}
            rootAddress={result.address}
            flaggedAddresses={result.nodes
              .filter((n) => n.is_flagged)
              .map((n) => n.address)}
          />
        )}
      </div>

      {/* Features */}
      {hasFeatures && (
        <div className="card">
          <p className="section-title">ML features</p>
          <FeaturesTable features={result.features} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnalyzePage() {
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState("BTC");
  const [depth, setDepth] = useState(2);
  const [txLimit, setTxLimit] = useState(10);
  const [periodDaysRaw, setPeriodDaysRaw] = useState("");

  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [bannerError, setBannerError] = useState<{ kind: "warning" | "error"; message: string } | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

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

      {/* Banner errors */}
      {bannerError && (
        <div className={`alert ${bannerError.kind}`}>{bannerError.message}</div>
      )}

      {/* Analysis form */}
      <div className="card">
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-grid">
            {/* Address — full width */}
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

            {/* Network */}
            <div className="form-group">
              <label htmlFor="network">Network</label>
              <select
                id="network"
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
              >
                {SUPPORTED_NETWORKS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              {formErrors.network && (
                <span className="field-error">{formErrors.network}</span>
              )}
            </div>

            {/* Depth */}
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

            {/* Tx limit */}
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

            {/* Period days — optional */}
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
            <button type="submit" className="btn" disabled={loading}>
              {loading && <span className="spinner" />}
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </form>
      </div>

      {/* Result */}
      {result && <ResultPanel result={result} />}
    </div>
  );
}
