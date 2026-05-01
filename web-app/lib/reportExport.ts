type AnalysisExportResult = {
  request_id?: string;
  result_id: string;
  address: string;
  network: string;
  risk_score?: number;
  risk_level?: string;
  model_version?: string;
  scoring_method?: string;
  flag_type?: string | null;
  nodes_count?: number;
  edges_count?: number;
  analyzed_at?: string;
  factors?: Array<{
    key?: string;
    label?: string;
    value?: unknown;
    severity?: string;
    description?: string;
  }>;
  nodes?: Array<{
    address?: string;
    depth?: number;
    is_root?: boolean;
    is_flagged?: boolean;
    flag_types?: string[];
  }>;
  edges?: Array<{
    from_address?: string;
    to_address?: string;
    tx_count?: number;
    total_amount?: number;
    first_seen?: number | null;
    last_seen?: number | null;
  }>;
  features?: Record<string, unknown>;
};

export function buildAnalysisExportFilename(
  result: Pick<AnalysisExportResult, "address" | "network" | "result_id">,
  extension: "json" | "html"
): string {
  return `analysis-${result.address}-${result.network}-${result.result_id.slice(0, 8)}.${extension}`;
}

export function buildAnalysisJsonExport(result: AnalysisExportResult): string {
  return JSON.stringify(result, null, 2);
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function escapeHtml(value: unknown): string {
  return stringifyValue(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRiskScore(score: unknown): string {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(2) : stringifyValue(score);
}

function formatAmount(amount: unknown): string {
  return typeof amount === "number" && Number.isFinite(amount) ? amount.toFixed(8) : stringifyValue(amount);
}

function formatFeatureValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : stringifyValue(value);
}

function formatUnixTimestamp(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "N/A";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function summaryRow(label: string, value: unknown): string {
  return `
          <div class="summary-item">
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>`;
}

function emptyRow(message: string, colspan: number): string {
  return `<tr><td colspan="${colspan}" class="empty">${escapeHtml(message)}</td></tr>`;
}

function buildRiskFactorsRows(result: AnalysisExportResult): string {
  const factors = Array.isArray(result.factors) ? result.factors : [];
  if (factors.length === 0) {
    return `<p class="empty">No risk factors identified.</p>`;
  }
  return `
        <ul class="factor-list">
          ${factors.map((factor) => `
            <li>
              <div class="factor-heading">
                <span class="badge">${escapeHtml(factor.severity)}</span>
                <strong>${escapeHtml(factor.label)}</strong>
                <span>${escapeHtml(factor.value)}</span>
              </div>
              <p>${escapeHtml(factor.description)}</p>
            </li>`).join("")}
        </ul>`;
}

function buildNodesRows(result: AnalysisExportResult): string {
  const nodes = Array.isArray(result.nodes) ? result.nodes : [];
  if (nodes.length === 0) {
    return emptyRow("No nodes available.", 5);
  }
  return nodes.map((node) => `
            <tr>
              <td class="mono">${escapeHtml(node.address)}</td>
              <td>${escapeHtml(node.depth)}</td>
              <td>${escapeHtml(node.is_root ? "Yes" : "")}</td>
              <td>${escapeHtml(node.is_flagged ? "Yes" : "")}</td>
              <td>${escapeHtml(Array.isArray(node.flag_types) ? node.flag_types.join(", ") : "")}</td>
            </tr>`).join("");
}

function buildEdgesRows(result: AnalysisExportResult): string {
  const edges = Array.isArray(result.edges) ? result.edges : [];
  if (edges.length === 0) {
    return emptyRow("No edges available.", 6);
  }
  return edges.map((edge) => `
            <tr>
              <td class="mono">${escapeHtml(edge.from_address)}</td>
              <td class="mono">${escapeHtml(edge.to_address)}</td>
              <td>${escapeHtml(edge.tx_count)}</td>
              <td>${escapeHtml(formatAmount(edge.total_amount))}</td>
              <td>${escapeHtml(formatUnixTimestamp(edge.first_seen))}</td>
              <td>${escapeHtml(formatUnixTimestamp(edge.last_seen))}</td>
            </tr>`).join("");
}

function buildFeaturesSection(result: AnalysisExportResult): string {
  const entries = Object.entries(result.features ?? {});
  const rows = entries.length === 0
    ? emptyRow("No ML features available.", 2)
    : entries.map(([key, value]) => `
            <tr>
              <td class="mono">${escapeHtml(key)}</td>
              <td>${escapeHtml(formatFeatureValue(value))}</td>
            </tr>`).join("");

  return `
      <section>
        <h2>ML features</h2>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>`;
}

export function buildAnalysisHtmlExport(result: AnalysisExportResult): string {
  const exportedAt = new Date().toISOString();
  const title = `Risk report ${result.network} ${result.address}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        background: #f7f8fb;
        color: #161922;
        font-family: Arial, Helvetica, sans-serif;
        line-height: 1.45;
      }
      main {
        max-width: 1120px;
        margin: 0 auto;
        padding: 32px 24px 48px;
      }
      header, section {
        background: #ffffff;
        border: 1px solid #d9dde7;
        border-radius: 8px;
        margin-bottom: 18px;
        padding: 20px;
      }
      h1, h2, p { margin-top: 0; }
      h1 { font-size: 28px; margin-bottom: 8px; }
      h2 { font-size: 18px; margin-bottom: 14px; }
      .muted, dt { color: #5d6678; }
      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        margin: 18px 0 0;
      }
      .summary-item {
        border: 1px solid #e4e7ee;
        border-radius: 6px;
        padding: 12px;
      }
      dt {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      dd {
        margin: 4px 0 0;
        overflow-wrap: anywhere;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th, td {
        border: 1px solid #e4e7ee;
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
      }
      th { background: #eef1f7; }
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        overflow-wrap: anywhere;
      }
      .factor-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .factor-list li {
        border: 1px solid #e4e7ee;
        border-radius: 6px;
        margin-bottom: 10px;
        padding: 12px;
      }
      .factor-heading {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .badge {
        background: #eef1f7;
        border-radius: 999px;
        color: #30384a;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
      }
      .empty {
        color: #687184;
        font-style: italic;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Risk Analysis Report</h1>
        <p class="muted">Static history export. Interactive graph and Sankey views are not included in this HTML file.</p>
        <dl class="summary">
          ${summaryRow("Address", result.address)}
          ${summaryRow("Network", result.network)}
          ${summaryRow("Risk score", formatRiskScore(result.risk_score))}
          ${summaryRow("Risk level", result.risk_level)}
          ${summaryRow("Scoring method", result.scoring_method)}
          ${summaryRow("Model version", result.model_version)}
          ${result.flag_type ? summaryRow("Flag type", result.flag_type) : ""}
          ${summaryRow("Nodes / Edges", `${result.nodes_count ?? 0} / ${result.edges_count ?? 0}`)}
          ${summaryRow("Analyzed at", result.analyzed_at)}
          ${summaryRow("Exported at", exportedAt)}
        </dl>
      </header>

      <section>
        <h2>Risk factors</h2>
        ${buildRiskFactorsRows(result)}
      </section>

      <section>
        <h2>Nodes</h2>
        <table>
          <thead>
            <tr>
              <th>Address</th>
              <th>Depth</th>
              <th>Root</th>
              <th>Flagged</th>
              <th>Flag types</th>
            </tr>
          </thead>
          <tbody>
            ${buildNodesRows(result)}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Edges</h2>
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
            ${buildEdgesRows(result)}
          </tbody>
        </table>
      </section>

      ${buildFeaturesSection(result)}
    </main>
  </body>
</html>`;
}
