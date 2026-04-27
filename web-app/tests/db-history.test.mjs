// Integration tests for getAnalysisHistory and getAnalysisResult DB helpers.
// Requires a live Postgres database reachable at DATABASE_URL (reads from .env.local).
// Skips automatically when DATABASE_URL is not set.
// Run: node --test web-app/tests/db-history.test.mjs
//
// Each test suite seeds its own isolated rows using unique UUIDs and cleans up
// after itself — safe to run against the shared dev database.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

// ─── Load DATABASE_URL from .env.local if present ────────────────────────────

function loadEnv() {
  const envPath = resolve(__dir, "../.env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.log("# Skipping DB integration tests: DATABASE_URL not set");
  process.exit(0);
}

// ─── Inline the DB helpers under test ────────────────────────────────────────
// We replicate the exact SQL from lib/db.ts so the test exercises the real
// query logic without going through TypeScript or Next.js imports.

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function query(text, values = []) {
  return pool.query(text, values);
}

function rowToHistoryItem(row) {
  return {
    request_id: row.request_id,
    result_id: row.result_id,
    address: row.address,
    network_code: row.network_code,
    risk_score: parseFloat(row.risk_score),
    risk_level: row.risk_level,
    scoring_method: row.scoring_method ?? "",
    model_version: row.model_version ?? "",
    status: row.status,
    analyzed_at: row.analyzed_at instanceof Date
      ? row.analyzed_at.toISOString()
      : String(row.analyzed_at),
    user_id: row.user_id,
    user_email: row.user_email,
  };
}

async function getAnalysisHistory(userId, limit, offset) {
  const listParams = [limit, offset];
  const listFilter = userId ? `AND ar.user_id = $3` : "";
  if (userId) listParams.push(userId);

  const countParams = userId ? [userId] : [];
  const countFilter = userId ? `AND ar.user_id = $1` : "";

  const [listResult, countResult] = await Promise.all([
    query(
      `SELECT ar.id AS request_id, res.id AS result_id, res.address,
              res.network_code, res.risk_score, res.risk_level,
              (res.factors_json->>'scoring_method') AS scoring_method,
              res.model_version, ar.status, res.analyzed_at,
              ar.user_id, u.email AS user_email
       FROM analysis_requests ar
       JOIN analysis_results res ON res.request_id = ar.id
       LEFT JOIN users u ON u.id = ar.user_id
       WHERE ar.status = 'completed'
       ${listFilter}
       ORDER BY res.analyzed_at DESC
       LIMIT $1 OFFSET $2`,
      listParams
    ),
    query(
      `SELECT COUNT(*) AS total
       FROM analysis_requests ar
       JOIN analysis_results res ON res.request_id = ar.id
       WHERE ar.status = 'completed'
       ${countFilter}`,
      countParams
    ),
  ]);

  return {
    items: listResult.rows.map(rowToHistoryItem),
    total: parseInt(countResult.rows[0]?.total ?? "0", 10),
  };
}

async function getAnalysisResult(resultId, userId) {
  const ownerFilter = userId ? `AND ar.user_id = $2` : "";
  const params = [resultId];
  if (userId) params.push(userId);

  const detailResult = await query(
    `SELECT ar.id AS request_id, res.id AS result_id, res.address,
            res.network_code, res.risk_score, res.risk_level,
            (res.factors_json->>'scoring_method') AS scoring_method,
            res.model_version, ar.status, res.analyzed_at,
            ar.user_id, u.email AS user_email,
            (res.factors_json->>'flag_type') AS flag_type,
            res.factors_json
     FROM analysis_results res
     JOIN analysis_requests ar ON ar.id = res.request_id
     LEFT JOIN users u ON u.id = ar.user_id
     WHERE res.id = $1
     ${ownerFilter}`,
    params
  );

  if (!detailResult.rows[0]) return null;
  const row = detailResult.rows[0];

  const [nodesResult, edgesResult] = await Promise.all([
    query(
      `SELECT address, depth, is_root, is_flagged, flag_types
       FROM address_nodes WHERE result_id = $1 ORDER BY depth, address`,
      [resultId]
    ),
    query(
      `SELECT from_address, to_address, tx_count, amount, first_seen, last_seen
       FROM graph_edges WHERE result_id = $1 ORDER BY tx_count DESC`,
      [resultId]
    ),
  ]);

  const base = rowToHistoryItem(row);
  return {
    ...base,
    flag_type: row.flag_type ?? null,
    nodes_count: nodesResult.rows.length,
    edges_count: edgesResult.rows.length,
    factors_json: row.factors_json,
    nodes: nodesResult.rows,
    edges: edgesResult.rows,
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

// Inserts a minimal completed analysis_request + analysis_result for a given userId.
// Returns { requestId, resultId } for cleanup.
async function seedAnalysis(userId, address = "1TestAddress00000001") {
  const requestId = randomUUID();
  const resultId = randomUUID();

  await query(
    `INSERT INTO analysis_requests (id, user_id, network_code, address, depth, limit_tx, status, created_at)
     VALUES ($1, $2, 'BTC', $3, 2, 50, 'completed', NOW())`,
    [requestId, userId, address]
  );
  await query(
    `INSERT INTO analysis_results (id, request_id, address, network_code, risk_score, risk_level, analyzed_at)
     VALUES ($1, $2, $3, 'BTC', 42.00, 'MEDIUM', NOW())`,
    [resultId, requestId, address]
  );
  // Link result back to request
  await query(
    `UPDATE analysis_requests SET result_id = $1 WHERE id = $2`,
    [resultId, requestId]
  );

  return { requestId, resultId };
}

async function seedUser(suffix = "") {
  const id = randomUUID();
  const email = `test-history-${id.slice(0, 8)}${suffix}@test.invalid`;
  await query(
    `INSERT INTO users (id, email, is_blocked) VALUES ($1, $2, FALSE)`,
    [id, email]
  );
  // Ensure 'user' role exists and assign it
  await query(`INSERT INTO roles (name) VALUES ('user') ON CONFLICT (name) DO NOTHING`);
  await query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'user'`,
    [id]
  );
  return { id, email };
}

async function cleanupUser(userId) {
  // CASCADE deletes handle analysis_requests → analysis_results → nodes/edges
  await query(`DELETE FROM analysis_requests WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
}

// ─── Test state ───────────────────────────────────────────────────────────────

let userA, userB;
let analysisA1, analysisA2, analysisB1;

before(async () => {
  userA = await seedUser("-a");
  userB = await seedUser("-b");
  analysisA1 = await seedAnalysis(userA.id, "1AddressA001");
  analysisA2 = await seedAnalysis(userA.id, "1AddressA002");
  analysisB1 = await seedAnalysis(userB.id, "1AddressB001");
});

after(async () => {
  await cleanupUser(userA.id);
  await cleanupUser(userB.id);
  await pool.end();
});

// ─── getAnalysisHistory tests ─────────────────────────────────────────────────

test("getAnalysisHistory: userId filter returns only own results", async () => {
  const { items, total } = await getAnalysisHistory(userA.id, 20, 0);
  const ids = items.map((i) => i.result_id);
  assert.ok(ids.includes(analysisA1.resultId), "should include userA analysis 1");
  assert.ok(ids.includes(analysisA2.resultId), "should include userA analysis 2");
  assert.ok(!ids.includes(analysisB1.resultId), "should NOT include userB analysis");
  assert.ok(total >= 2, "total should be at least 2");
});

test("getAnalysisHistory: userId = null (admin) returns all results including both users", async () => {
  const { items, total } = await getAnalysisHistory(null, 200, 0);
  const ids = items.map((i) => i.result_id);
  assert.ok(ids.includes(analysisA1.resultId), "admin should see userA analysis");
  assert.ok(ids.includes(analysisB1.resultId), "admin should see userB analysis");
  assert.ok(total >= 3, "total should include all seeded rows");
});

test("getAnalysisHistory: pagination limit is respected", async () => {
  const { items } = await getAnalysisHistory(null, 1, 0);
  assert.equal(items.length, 1);
});

test("getAnalysisHistory: offset skips rows", async () => {
  const page1 = await getAnalysisHistory(userA.id, 1, 0);
  const page2 = await getAnalysisHistory(userA.id, 1, 1);
  assert.equal(page1.items.length, 1);
  assert.equal(page2.items.length, 1);
  assert.notEqual(page1.items[0].result_id, page2.items[0].result_id);
});

test("getAnalysisHistory: items have correct shape", async () => {
  const { items } = await getAnalysisHistory(userA.id, 1, 0);
  const item = items[0];
  assert.ok(typeof item.request_id === "string");
  assert.ok(typeof item.result_id === "string");
  assert.ok(typeof item.address === "string");
  assert.ok(typeof item.network_code === "string");
  assert.ok(typeof item.risk_score === "number");
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(item.risk_level));
  assert.ok(typeof item.analyzed_at === "string");
});

test("getAnalysisHistory: userB filter does NOT return userA results", async () => {
  const { items } = await getAnalysisHistory(userB.id, 20, 0);
  const ids = items.map((i) => i.result_id);
  assert.ok(!ids.includes(analysisA1.resultId));
  assert.ok(!ids.includes(analysisA2.resultId));
  assert.ok(ids.includes(analysisB1.resultId));
});

// ─── getAnalysisResult tests ──────────────────────────────────────────────────

test("getAnalysisResult: owner can fetch own result", async () => {
  const detail = await getAnalysisResult(analysisA1.resultId, userA.id);
  assert.ok(detail !== null);
  assert.equal(detail.result_id, analysisA1.resultId);
  assert.equal(detail.address, "1AddressA001");
});

test("getAnalysisResult: non-owner gets null (ownership violation → 404)", async () => {
  // userB attempts to fetch userA's result
  const detail = await getAnalysisResult(analysisA1.resultId, userB.id);
  assert.equal(detail, null);
});

test("getAnalysisResult: admin (userId = null) can fetch any result", async () => {
  const detailA = await getAnalysisResult(analysisA1.resultId, null);
  const detailB = await getAnalysisResult(analysisB1.resultId, null);
  assert.ok(detailA !== null);
  assert.ok(detailB !== null);
  assert.equal(detailA.result_id, analysisA1.resultId);
  assert.equal(detailB.result_id, analysisB1.resultId);
});

test("getAnalysisResult: unknown resultId returns null (→ 404)", async () => {
  const detail = await getAnalysisResult(randomUUID(), userA.id);
  assert.equal(detail, null);
});

test("getAnalysisResult: unknown resultId with admin access returns null", async () => {
  const detail = await getAnalysisResult(randomUUID(), null);
  assert.equal(detail, null);
});

test("getAnalysisResult: detail has correct shape", async () => {
  const detail = await getAnalysisResult(analysisA1.resultId, userA.id);
  assert.ok(detail !== null);
  assert.ok(typeof detail.nodes_count === "number");
  assert.ok(typeof detail.edges_count === "number");
  assert.ok(Array.isArray(detail.nodes));
  assert.ok(Array.isArray(detail.edges));
});
