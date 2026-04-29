// Integration tests for admin network DB helpers.
// Skipped when DATABASE_URL is not set.
// Run: DATABASE_URL=<url> node --test web-app/tests/db-admin-networks.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP = !DATABASE_URL;

let pool;
let query;
const TEST_CODE = "ZZTEST";

async function setupPool() {
  const { Pool } = await import("pg");
  pool = new Pool({ connectionString: DATABASE_URL });
  query = (text, values = []) => pool.query(text, values);
}

async function listAllNetworks() {
  const result = await query(
    `SELECT id, code, name, is_active FROM networks ORDER BY code`,
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
    `SELECT id, code, name, is_active FROM networks WHERE code = $1 LIMIT 1`,
    [code.trim().toUpperCase()]
  );
  return result.rows[0] ?? null;
}

before(async () => {
  if (SKIP) return;
  await setupPool();
  await query(
    `INSERT INTO networks (code, name, is_active)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE`,
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
