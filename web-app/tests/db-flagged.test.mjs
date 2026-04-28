// Integration tests for flagged-address DB helpers.
// Skipped when DATABASE_URL is not set — no Docker or external service required
// when running locally without a Postgres connection.
// Run with: DATABASE_URL=<url> node --test web-app/tests/db-flagged.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP = !DATABASE_URL;

// Dynamic import of pg — only resolved at runtime when URL is set.
let pool;
let query;

async function setupPool() {
  const { Pool } = await import("pg");
  pool = new Pool({ connectionString: DATABASE_URL });
  query = (text, values = []) => pool.query(text, values);
}

// ─── Minimal inline DB helpers (mirrors lib/db.ts logic exactly) ──────────────

async function getNetworkId(code) {
  const r = await query("SELECT id FROM networks WHERE code = $1", [code.toUpperCase()]);
  return r.rows[0]?.id ?? null;
}

async function getCategoryId(code) {
  const r = await query("SELECT id FROM risk_categories WHERE code = $1", [code.toLowerCase()]);
  return r.rows[0]?.id ?? null;
}

async function createRecord(networkCode, address, categoryCode, userId, comment = null) {
  const id = randomUUID();
  const network_id = await getNetworkId(networkCode);
  const risk_category_id = await getCategoryId(categoryCode);
  if (!network_id || !risk_category_id) throw new Error("Setup: unknown network or category");
  await query(
    `INSERT INTO flagged_addresses (id, network_id, address, risk_category_id, comment, created_by_user_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
    [id, network_id, address, risk_category_id, comment, userId]
  );
  return id;
}

async function deleteRecord(id) {
  await query("DELETE FROM flagged_addresses WHERE id = $1", [id]);
}

async function getRecord(id) {
  const r = await query("SELECT * FROM flagged_addresses WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

// ─── Setup: create a test user ────────────────────────────────────────────────

let testUserId;
let testUserId2;
const TEST_ADDRESS = `test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const TEST_ADDRESS_2 = `test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const TEST_ADDRESS_3 = `test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const createdIds = [];

before(async () => {
  if (SKIP) return;
  await setupPool();

  // Ensure test users exist
  testUserId = randomUUID();
  testUserId2 = randomUUID();

  await query(`INSERT INTO roles (name) VALUES ('moderator') ON CONFLICT (name) DO NOTHING`);
  for (const uid of [testUserId, testUserId2]) {
    const email = `test-flagged-${uid}@test.invalid`;
    await query(
      `INSERT INTO users (id, email, password_hash, is_blocked) VALUES ($1, $2, NULL, FALSE) ON CONFLICT DO NOTHING`,
      [uid, email]
    );
    await query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'moderator' ON CONFLICT DO NOTHING`,
      [uid]
    );
  }
});

after(async () => {
  if (SKIP) return;
  // Clean up all records created during tests
  for (const id of createdIds) {
    await deleteRecord(id).catch(() => {});
  }
  await query(`DELETE FROM users WHERE id = ANY($1)`, [[testUserId, testUserId2]]).catch(() => {});
  await pool.end();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("create: inserts a new active flagged address", { skip: SKIP }, async () => {
  const id = await createRecord("BTC", TEST_ADDRESS, "scam", testUserId, "test comment");
  createdIds.push(id);

  const row = await getRecord(id);
  assert.ok(row);
  assert.equal(row.is_active, true);
  assert.equal(row.address, TEST_ADDRESS);
  assert.equal(row.comment, "test comment");
  assert.equal(row.created_by_user_id, testUserId);
});

test("create: duplicate (network_id, address) raises unique constraint", { skip: SKIP }, async () => {
  const addr = `dup${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const id1 = await createRecord("BTC", addr, "scam", testUserId);
  createdIds.push(id1);

  await assert.rejects(
    () => createRecord("BTC", addr, "mixer", testUserId2),
    (err) => {
      // pg unique violation code
      assert.ok(err.code === "23505" || /unique/i.test(err.message));
      return true;
    }
  );
});

test("create: same address on different networks both succeed", { skip: SKIP }, async () => {
  const addr = `multi${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const id1 = await createRecord("BTC", addr, "scam", testUserId);
  const id2 = await createRecord("ETH", addr, "scam", testUserId);
  createdIds.push(id1, id2);
  assert.notEqual(id1, id2);
  const r1 = await getRecord(id1);
  const r2 = await getRecord(id2);
  assert.ok(r1);
  assert.ok(r2);
  assert.equal(r1.address, addr);
  assert.equal(r2.address, addr);
});

test("deactivate: sets is_active=FALSE", { skip: SKIP }, async () => {
  const id = await createRecord("BTC", TEST_ADDRESS_2, "mixer", testUserId);
  createdIds.push(id);

  const updated = await query(
    "UPDATE flagged_addresses SET is_active = FALSE WHERE id = $1 AND is_active = TRUE RETURNING id",
    [id]
  );
  assert.equal(updated.rowCount, 1);

  const row = await getRecord(id);
  assert.equal(row.is_active, false);
});

test("deactivate: already-inactive record → 0 rows updated", { skip: SKIP }, async () => {
  const id = await createRecord("BTC", TEST_ADDRESS_3, "phishing", testUserId);
  createdIds.push(id);

  // Deactivate once
  await query("UPDATE flagged_addresses SET is_active = FALSE WHERE id = $1", [id]);

  // Attempt again
  const result = await query(
    "UPDATE flagged_addresses SET is_active = FALSE WHERE id = $1 AND is_active = TRUE",
    [id]
  );
  assert.equal(result.rowCount, 0);
});

test("list with network filter: returns only matching network records", { skip: SKIP }, async () => {
  const addr = `netfilt${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const id = await createRecord("BTC", addr, "scam", testUserId);
  createdIds.push(id);

  const r = await query(
    `SELECT fa.id FROM flagged_addresses fa
     JOIN networks n ON n.id = fa.network_id
     WHERE n.code = 'BTC' AND fa.address = $1 AND fa.is_active = TRUE`,
    [addr]
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, id);
});

test("list with category filter: returns only matching category records", { skip: SKIP }, async () => {
  const addr = `catfilt${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const id = await createRecord("ETH", addr, "sanctions", testUserId);
  createdIds.push(id);

  const r = await query(
    `SELECT fa.id FROM flagged_addresses fa
     JOIN risk_categories rc ON rc.id = fa.risk_category_id
     WHERE rc.code = 'sanctions' AND fa.address = $1 AND fa.is_active = TRUE`,
    [addr]
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, id);
});

test("importFlaggedAddresses: ON CONFLICT DO NOTHING skips duplicates", { skip: SKIP }, async () => {
  const addr = `import${randomUUID().replace(/-/g, "").slice(0, 15)}`;
  const network_id = await getNetworkId("BTC");
  const risk_category_id = await getCategoryId("scam");
  const id1 = randomUUID();

  // First insert
  const r1 = await query(
    `INSERT INTO flagged_addresses (id, network_id, address, risk_category_id, comment, created_by_user_id, is_active)
     VALUES ($1, $2, $3, $4, NULL, $5, TRUE) ON CONFLICT (network_id, address) DO NOTHING`,
    [id1, network_id, addr, risk_category_id, testUserId]
  );
  createdIds.push(id1);
  assert.equal(r1.rowCount, 1);

  // Second insert — same (network_id, address) → skipped
  const id2 = randomUUID();
  const r2 = await query(
    `INSERT INTO flagged_addresses (id, network_id, address, risk_category_id, comment, created_by_user_id, is_active)
     VALUES ($1, $2, $3, $4, NULL, $5, TRUE) ON CONFLICT (network_id, address) DO NOTHING`,
    [id2, network_id, addr, risk_category_id, testUserId2]
  );
  assert.equal(r2.rowCount, 0);
});

test("update: changes category and comment", { skip: SKIP }, async () => {
  const addr = `upd${randomUUID().replace(/-/g, "").slice(0, 17)}`;
  const id = await createRecord("ETH", addr, "scam", testUserId, "original");
  createdIds.push(id);

  const mixerCatId = await getCategoryId("mixer");
  await query(
    "UPDATE flagged_addresses SET risk_category_id = $1, comment = $2 WHERE id = $3 AND is_active = TRUE",
    [mixerCatId, "updated comment", id]
  );

  const row = await getRecord(id);
  const catCheck = await query("SELECT code FROM risk_categories WHERE id = $1", [row.risk_category_id]);
  assert.equal(catCheck.rows[0].code, "mixer");
  assert.equal(row.comment, "updated comment");
});
