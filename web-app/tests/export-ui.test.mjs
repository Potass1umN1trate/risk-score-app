// Unit tests for the JSON export logic from /history/[id]/page.tsx.
// The export function is pure (constructs filename and serializes result) —
// we test the filename generation and JSON serialization behaviour without a DOM.
// Run: node --test web-app/tests/export-ui.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Inline the export filename logic from history/[id]/page.tsx ─────────────

function buildExportFilename(result) {
  return `analysis-${result.address}-${result.network}-${result.result_id.slice(0, 8)}.json`;
}

function buildExportPayload(result) {
  return JSON.stringify(result, null, 2);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("export: filename contains address, network, and first 8 chars of result_id", () => {
  const result = {
    address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
    network: "BTC",
    result_id: "abcd1234-ef56-7890-abcd-ef1234567890",
  };
  const filename = buildExportFilename(result);
  assert.ok(filename.startsWith("analysis-1BoatSLRHtKNngkdXEeobR76b53LETtpyT-BTC-abcd1234"));
  assert.ok(filename.endsWith(".json"));
});

test("export: filename uses first 8 chars of result_id only", () => {
  const result = { address: "addr", network: "ETH", result_id: "12345678-long-id" };
  const filename = buildExportFilename(result);
  assert.ok(filename.includes("12345678"));
  assert.ok(!filename.includes("long-id"));
});

test("export: JSON payload is valid JSON", () => {
  const result = {
    address: "addr", network: "BTC", result_id: "abc-123",
    risk_score: 42.5, risk_level: "MEDIUM", factors: [], features: {},
    nodes: [], edges: [], analyzed_at: "2024-01-01T00:00:00.000Z",
  };
  const payload = buildExportPayload(result);
  const parsed = JSON.parse(payload);
  assert.equal(parsed.risk_score, 42.5);
  assert.equal(parsed.risk_level, "MEDIUM");
});

test("export: JSON payload preserves all result fields", () => {
  const result = {
    request_id: "req-1", result_id: "res-1",
    address: "1ABC", network: "BTC",
    risk_score: 75.0, risk_level: "HIGH",
    model_version: "universal_xgboost_v1", scoring_method: "ml_model",
    flag_type: null, nodes_count: 2, edges_count: 1,
    analyzed_at: "2024-06-15T12:00:00.000Z",
    factors: [{ key: "k", label: "L", value: 1, severity: "HIGH", description: "d" }],
    features: { tx_in_count: 10 },
    nodes: [{ address: "1ABC", depth: 0, is_root: true, is_flagged: false, flag_types: [] }],
    edges: [{ from_address: "1ABC", to_address: "1XYZ", tx_count: 1, total_amount: 0.5, first_seen: null, last_seen: null }],
  };
  const parsed = JSON.parse(buildExportPayload(result));
  assert.equal(parsed.request_id, "req-1");
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.edges[0].total_amount, 0.5);
  assert.equal(parsed.factors[0].key, "k");
});

test("export: null fields are preserved in JSON output", () => {
  const result = { address: "a", network: "ETH", result_id: "x", flag_type: null, features: {} };
  const parsed = JSON.parse(buildExportPayload(result));
  assert.equal(parsed.flag_type, null);
});

test("export: JSON is pretty-printed with 2-space indent", () => {
  const result = { address: "a", network: "ETH", result_id: "x" };
  const payload = buildExportPayload(result);
  // Pretty-printed JSON starts with "{\n  "
  assert.ok(payload.startsWith("{\n  "));
});
