// Unit tests for saved analysis export helpers.
// Run: node --test web-app/tests/export-ui.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalysisExportFilename,
  buildAnalysisHtmlExport,
  buildAnalysisJsonExport,
} from "../lib/reportExport.ts";

const fullResult = {
  request_id: "req-1",
  result_id: "abcd1234-ef56-7890-abcd-ef1234567890",
  address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
  network: "BTC",
  risk_score: 75,
  risk_level: "HIGH",
  model_version: "universal_xgboost_v1",
  scoring_method: "ml_model",
  flag_type: "mixer",
  nodes_count: 2,
  edges_count: 1,
  analyzed_at: "2024-06-15T12:00:00.000Z",
  factors: [
    {
      key: "flagged_counterparty",
      label: "Flagged counterparty",
      value: 1,
      severity: "HIGH",
      description: "A connected address is flagged.",
    },
  ],
  features: { tx_in_count: 10, suspicious_ratio: 0.42 },
  nodes: [
    { address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", depth: 0, is_root: true, is_flagged: false, flag_types: [] },
    { address: "1FlaggedAddress", depth: 1, is_root: false, is_flagged: true, flag_types: ["mixer"] },
  ],
  edges: [
    {
      from_address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
      to_address: "1FlaggedAddress",
      tx_count: 3,
      total_amount: 0.5,
      first_seen: 1718452800,
      last_seen: null,
    },
  ],
};

test("export: JSON filename contains address, network, and first 8 chars of result_id", () => {
  const filename = buildAnalysisExportFilename(fullResult, "json");
  assert.ok(filename.startsWith("analysis-1BoatSLRHtKNngkdXEeobR76b53LETtpyT-BTC-abcd1234"));
  assert.ok(filename.endsWith(".json"));
});

test("export: filename uses first 8 chars of result_id only", () => {
  const result = { address: "addr", network: "ETH", result_id: "12345678-long-id" };
  const filename = buildAnalysisExportFilename(result, "json");
  assert.ok(filename.includes("12345678"));
  assert.ok(!filename.includes("long-id"));
});

test("export: HTML filename mirrors JSON base naming", () => {
  const jsonFilename = buildAnalysisExportFilename(fullResult, "json");
  const htmlFilename = buildAnalysisExportFilename(fullResult, "html");
  assert.equal(htmlFilename, jsonFilename.replace(/\.json$/, ".html"));
  assert.ok(htmlFilename.endsWith(".html"));
});

test("export: JSON payload is valid JSON", () => {
  const payload = buildAnalysisJsonExport(fullResult);
  const parsed = JSON.parse(payload);
  assert.equal(parsed.risk_score, 75);
  assert.equal(parsed.risk_level, "HIGH");
});

test("export: JSON payload preserves all result fields", () => {
  const parsed = JSON.parse(buildAnalysisJsonExport(fullResult));
  assert.equal(parsed.request_id, "req-1");
  assert.equal(parsed.nodes.length, 2);
  assert.equal(parsed.edges[0].total_amount, 0.5);
  assert.equal(parsed.factors[0].key, "flagged_counterparty");
});

test("export: null fields are preserved in JSON output", () => {
  const result = { address: "a", network: "ETH", result_id: "x", flag_type: null, features: {} };
  const parsed = JSON.parse(buildAnalysisJsonExport(result));
  assert.equal(parsed.flag_type, null);
});

test("export: JSON is pretty-printed with 2-space indent", () => {
  const payload = buildAnalysisJsonExport({ address: "a", network: "ETH", result_id: "x" });
  assert.ok(payload.startsWith("{\n  "));
});

test("export: HTML contains key report fields", () => {
  const html = buildAnalysisHtmlExport(fullResult);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes("1BoatSLRHtKNngkdXEeobR76b53LETtpyT"));
  assert.ok(html.includes("BTC"));
  assert.ok(html.includes("75.00"));
  assert.ok(html.includes("HIGH"));
  assert.ok(html.includes("ml_model"));
  assert.ok(html.includes("universal_xgboost_v1"));
  assert.ok(html.includes("2024-06-15T12:00:00.000Z"));
});

test("export: HTML includes risk factors", () => {
  const html = buildAnalysisHtmlExport(fullResult);
  assert.ok(html.includes("Risk factors"));
  assert.ok(html.includes("Flagged counterparty"));
  assert.ok(html.includes("A connected address is flagged."));
});

test("export: HTML includes nodes table data", () => {
  const html = buildAnalysisHtmlExport(fullResult);
  assert.ok(html.includes("<h2>Nodes</h2>"));
  assert.ok(html.includes("1FlaggedAddress"));
  assert.ok(html.includes("mixer"));
});

test("export: HTML includes edges table data", () => {
  const html = buildAnalysisHtmlExport(fullResult);
  assert.ok(html.includes("<h2>Edges</h2>"));
  assert.ok(html.includes("0.50000000"));
  assert.ok(html.includes("2024-06-15 12:00:00 UTC"));
  assert.ok(html.includes("N/A"));
});

test("export: HTML includes features table data when present", () => {
  const html = buildAnalysisHtmlExport(fullResult);
  assert.ok(html.includes("ML features"));
  assert.ok(html.includes("tx_in_count"));
  assert.ok(html.includes("10.000000"));
  assert.ok(html.includes("suspicious_ratio"));
  assert.ok(html.includes("0.420000"));
});

test("export: HTML handles empty factors, nodes, edges, and features", () => {
  const html = buildAnalysisHtmlExport({
    address: "empty",
    network: "ETH",
    result_id: "empty-123",
    risk_score: 0,
    risk_level: "LOW",
    scoring_method: "",
    model_version: "",
    analyzed_at: "2024-01-01T00:00:00.000Z",
    factors: [],
    nodes: [],
    edges: [],
    features: {},
  });

  assert.ok(html.includes("No risk factors identified."));
  assert.ok(html.includes("No nodes available."));
  assert.ok(html.includes("No edges available."));
  assert.ok(html.includes("No ML features available."));
});

test("export: HTML escapes unsafe dynamic values", () => {
  const html = buildAnalysisHtmlExport({
    address: '<script>alert("x")</script>',
    network: "BTC & ETH",
    result_id: "unsafe-12345678",
    risk_score: 99,
    risk_level: "HIGH",
    scoring_method: 'ml_"model"',
    model_version: "v1's",
    analyzed_at: "2024-01-01T00:00:00.000Z",
    factors: [
      {
        label: "<script>factor</script>",
        value: { note: "A&B" },
        severity: "HIGH",
        description: "quoted \"value\" and user's apostrophe",
      },
    ],
    nodes: [
      { address: "<node>", depth: 0, is_root: true, is_flagged: false, flag_types: ["a&b"] },
    ],
    edges: [
      { from_address: "<from>", to_address: "'to'", tx_count: 1, total_amount: 1, first_seen: null, last_seen: null },
    ],
    features: { "<feature>": 'quote" apostrophe\'' },
  });

  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<script>factor</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("BTC &amp; ETH"));
  assert.ok(html.includes("ml_&quot;model&quot;"));
  assert.ok(html.includes("v1&#39;s"));
  assert.ok(html.includes("&quot;A&amp;B&quot;"));
  assert.ok(html.includes("user&#39;s apostrophe"));
  assert.ok(html.includes("&lt;node&gt;"));
  assert.ok(html.includes("&#39;to&#39;"));
  assert.ok(html.includes("&lt;feature&gt;"));
});
