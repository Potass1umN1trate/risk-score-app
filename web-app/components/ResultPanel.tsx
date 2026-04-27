"use client";

import dynamic from "next/dynamic";
import type { NodeOut, EdgeOut, RiskFactor } from "@/lib/analytics";

const TransactionGraph = dynamic(() => import("@/components/TransactionGraph"), { ssr: false });
const SankeyDiagram = dynamic(() => import("@/components/SankeyDiagram"), { ssr: false });

// Shared result shape accepted by ResultPanel.
// Compatible with both AnalyzeResponse (fresh analysis) and AnalysisDetail (from DB history).
export interface ResultData {
  request_id: string;
  result_id: string;
  address: string;
  network: string;
  risk_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  model_version: string;
  scoring_method: string;
  flag_type: string | null;
  nodes_count: number;
  edges_count: number;
  nodes: NodeOut[];
  edges: EdgeOut[];
  factors: RiskFactor[];
  features: Record<string, number>;
  analyzed_at: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

export function RiskBadge({ level }: { level: string }) {
  return <span className={`risk-badge ${level}`}>{level}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`risk-badge ${severity}`}>{severity}</span>;
}

export function ScoreBar({ score, level }: { score: number; level: string }) {
  return (
    <div className="score-bar-wrap">
      <div
        className={`score-bar-fill ${level}`}
        style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
      />
    </div>
  );
}

export function FactorList({ factors }: { factors: RiskFactor[] }) {
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

export function NodesTable({ nodes }: { nodes: NodeOut[] }) {
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

export function EdgesTable({ edges }: { edges: EdgeOut[] }) {
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

export function FeaturesTable({ features }: { features: Record<string, number> }) {
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

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ResultPanel({ result }: { result: ResultData }) {
  const hasFeatures = Object.keys(result.features).length > 0;

  return (
    <div>
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

      <div className="card">
        <p className="section-title">Risk factors</p>
        <FactorList factors={result.factors} />
      </div>

      {result.nodes.length > 0 && (
        <div className="card">
          <p className="section-title">Nodes ({result.nodes_count})</p>
          <NodesTable nodes={result.nodes} />
        </div>
      )}

      {result.edges.length > 0 && (
        <div className="card">
          <p className="section-title">Edges ({result.edges_count})</p>
          <EdgesTable edges={result.edges} />
        </div>
      )}

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

      {hasFeatures && (
        <div className="card">
          <p className="section-title">ML features</p>
          <FeaturesTable features={result.features} />
        </div>
      )}
    </div>
  );
}
