// Integration tests for admin network DB helpers.
// Skipped when DATABASE_URL is not set.
// Run: DATABASE_URL=<url> node --test web-app/tests/db-admin-networks.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP = !DATABASE_URL;
const MIGRATION_PATH = "../k8s/postgres/migrations/20260429_network_analysis_limits.sql";

let pool;
let query;
const TEST_CODE = "ZZTEST";

async function setupPool() {
  const { Pool } = await import("pg");
  pool = new Pool({ connectionString: DATABASE_URL });
  query = (text, values = []) => pool.query(text, values);
}

async function ensureNetworkLimitSchema() {
  const migrationSql = await readFile(MIGRATION_PATH, "utf8");
  await query(migrationSql);
  await query(migrationSql);
}

async function listAllNetworks() {
  const result = await query(
    `SELECT
       id,
       code,
       name,
       is_active,
       default_depth,
       max_depth,
       default_tx_limit,
       max_tx_limit,
       default_period_days,
       max_period_days
     FROM networks
     ORDER BY code`,
    []
  );
  return result.rows;
}

async function getNetworks() {
  const result = await query(
    `SELECT
       id,
       code,
       name,
       default_depth,
       max_depth,
       default_tx_limit,
       max_tx_limit,
       default_period_days,
       max_period_days
     FROM networks
     WHERE is_active = TRUE
     ORDER BY code`,
    []
  );
  return result.rows;
}

async function setNetworkActive(code, isActive) {
  const result = await query(
    `UPDATE networks SET is_active = $1 WHERE code = $2`,
    [isActive, code.trim().toUpperCase()]
  );
  return result.rowCount > 0;
}

async function getNetwork(code) {
  const result = await query(
    `SELECT
       id,
       code,
       name,
       is_active,
       default_depth,
       max_depth,
       default_tx_limit,
       max_tx_limit,
       default_period_days,
       max_period_days
     FROM networks
     WHERE code = $1
     LIMIT 1`,
    [code.trim().toUpperCase()]
  );
  return result.rows[0] ?? null;
}

async function updateNetworkLimits(code, patch) {
  const fields = [
    "default_depth",
    "max_depth",
    "default_tx_limit",
    "max_tx_limit",
    "default_period_days",
    "max_period_days",
  ].filter((field) => patch[field] !== undefined);

  if (fields.length === 0) return getNetwork(code);

  const values = fields.map((field) => patch[field]);
  values.push(code.trim().toUpperCase());
  const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(", ");
  const result = await query(
    `UPDATE networks
     SET ${setClause}
     WHERE code = $${values.length}
     RETURNING
       id,
       code,
       name,
       is_active,
       default_depth,
       max_depth,
       default_tx_limit,
       max_tx_limit,
       default_period_days,
       max_period_days`,
    values
  );
  return result.rows[0] ?? null;
}

before(async () => {
  if (SKIP) return;
  await setupPool();
  await ensureNetworkLimitSchema();
  await query(
    `INSERT INTO networks (
       code,
       name,
       is_active,
       default_depth,
       max_depth,
       default_tx_limit,
       max_tx_limit,
       default_period_days,
       max_period_days
     )
     VALUES ($1, $2, TRUE, 2, 5, 10, 200, NULL, 3650)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       is_active = TRUE,
       default_depth = 2,
       max_depth = 5,
       default_tx_limit = 10,
       max_tx_limit = 200,
       default_period_days = NULL,
       max_period_days = 3650`,
    [TEST_CODE, "Test Network"]
  );
});

after(async () => {
  if (SKIP) return;
  await query(`DELETE FROM networks WHERE code = $1`, [TEST_CODE]).catch(() => {});
  await pool.end();
});

test("listAllNetworks: returns networks including is_active", { skip: SKIP }, async () => {
  const networks = await listAllNetworks();
  assert.ok(networks.length >= 1);
  const testNetwork = networks.find((n) => n.code === TEST_CODE);
  assert.ok(testNetwork, "expected temporary test network");
  assert.equal(typeof testNetwork.id, "number");
  assert.equal(testNetwork.name, "Test Network");
  assert.equal(typeof testNetwork.is_active, "boolean");
  assert.equal(typeof testNetwork.default_depth, "number");
  assert.equal(typeof testNetwork.max_depth, "number");
  assert.equal(typeof testNetwork.default_tx_limit, "number");
  assert.equal(typeof testNetwork.max_tx_limit, "number");
  assert.equal(testNetwork.default_period_days, null);
  assert.equal(typeof testNetwork.max_period_days, "number");
});

test("getNetworks: returns active networks including analysis limits", { skip: SKIP }, async () => {
  await setNetworkActive(TEST_CODE, true);
  const networks = await getNetworks();
  const testNetwork = networks.find((n) => n.code === TEST_CODE);
  assert.ok(testNetwork, "expected active temporary test network");
  assert.equal(typeof testNetwork.default_depth, "number");
  assert.equal(typeof testNetwork.max_depth, "number");
  assert.equal(typeof testNetwork.default_tx_limit, "number");
  assert.equal(typeof testNetwork.max_tx_limit, "number");
  assert.equal(testNetwork.default_period_days, null);
  assert.equal(typeof testNetwork.max_period_days, "number");
});

test("setNetworkActive: disables and re-enables a known network", { skip: SKIP }, async () => {
  assert.equal(await setNetworkActive(TEST_CODE, false), true);
  let network = await getNetwork(TEST_CODE);
  assert.equal(network.is_active, false);

  assert.equal(await setNetworkActive(TEST_CODE, true), true);
  network = await getNetwork(TEST_CODE);
  assert.equal(network.is_active, true);
});

test("setNetworkActive: normalizes lowercase code", { skip: SKIP }, async () => {
  assert.equal(await setNetworkActive(TEST_CODE.toLowerCase(), false), true);
  const network = await getNetwork(TEST_CODE);
  assert.equal(network.is_active, false);
});

test("setNetworkActive: unknown network returns false", { skip: SKIP }, async () => {
  assert.equal(await setNetworkActive("NOT_A_NETWORK", true), false);
});

test("updateNetworkLimits: persists partial limit updates", { skip: SKIP }, async () => {
  const updated = await updateNetworkLimits(TEST_CODE, {
    default_depth: 3,
    max_depth: 6,
    default_tx_limit: 25,
    max_tx_limit: 250,
    default_period_days: 90,
    max_period_days: 720,
  });
  assert.ok(updated);
  assert.equal(updated.default_depth, 3);
  assert.equal(updated.max_depth, 6);
  assert.equal(updated.default_tx_limit, 25);
  assert.equal(updated.max_tx_limit, 250);
  assert.equal(updated.default_period_days, 90);
  assert.equal(updated.max_period_days, 720);

  const reloaded = await getNetwork(TEST_CODE);
  assert.equal(reloaded.default_depth, 3);
  assert.equal(reloaded.max_tx_limit, 250);
});

test("updateNetworkLimits: unknown network returns null", { skip: SKIP }, async () => {
  const updated = await updateNetworkLimits("NOT_A_NETWORK", { max_depth: 10 });
  assert.equal(updated, null);
});

test("network limit constraints: reject invalid defaults and maxes", { skip: SKIP }, async () => {
  await assert.rejects(
    updateNetworkLimits(TEST_CODE, { default_depth: 7, max_depth: 6 }),
    /constraint|violates/i
  );
  await assert.rejects(
    updateNetworkLimits(TEST_CODE, { default_tx_limit: 0 }),
    /constraint|violates/i
  );
  await assert.rejects(
    updateNetworkLimits(TEST_CODE, { default_period_days: 31, max_period_days: 30 }),
    /constraint|violates/i
  );
});
