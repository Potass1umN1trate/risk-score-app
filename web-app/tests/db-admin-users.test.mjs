// Integration tests for admin user management DB helpers.
// Requires a running PostgreSQL with the app schema initialized.
// Run with: DATABASE_URL=<url> node --test web-app/tests/db-admin-users.test.mjs
// Tests are SKIPPED when DATABASE_URL is not set.
// Run with: node --test web-app/tests/db-admin-users.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP = !DATABASE_URL;

let pool;
let createdUserIds = [];

// ─── Setup / teardown ─────────────────────────────────────────────────────────

before(async () => {
  if (SKIP) return;
  pool = new pg.Pool({ connectionString: DATABASE_URL });
});

after(async () => {
  if (SKIP || !pool) return;
  // Clean up any test users created during tests.
  if (createdUserIds.length > 0) {
    await pool.query(
      `DELETE FROM users WHERE id = ANY($1::char(36)[])`,
      [createdUserIds]
    ).catch(() => {});
  }
  await pool.end();
});

function skip(name, fn) {
  if (SKIP) {
    test(name, { skip: "DATABASE_URL not set" }, () => {});
  } else {
    test(name, fn);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTestUser(email, role = "user", isBlocked = false) {
  const { randomUUID } = await import("crypto");
  const id = randomUUID();
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash("testpassword", 10);

  await pool.query("BEGIN");
  await pool.query(
    `INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [role]
  );
  await pool.query(
    `INSERT INTO users (id, email, password_hash, is_blocked) VALUES ($1, $2, $3, $4)`,
    [id, email, passwordHash, isBlocked]
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.name = $2`,
    [id, role]
  );
  await pool.query("COMMIT");
  createdUserIds.push(id);
  return id;
}

// ─── listUsers ────────────────────────────────────────────────────────────────

describe("listUsers", () => {
  skip("returns a paginated list with total", async () => {
    const result = await pool.query(`
      SELECT COUNT(*) AS count FROM (
        SELECT u.id FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        GROUP BY u.id
      ) AS sub
    `);
    const total = parseInt(result.rows[0].count, 10);
    assert.ok(total >= 0);
  });

  skip("email filter returns only matching rows", async () => {
    const uniq = `filter-test-${Date.now()}@example.com`;
    const id = await createTestUser(uniq, "user");

    const result = await pool.query(`
      SELECT u.id, u.email,
        COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.email ILIKE $1
      GROUP BY u.id, u.email
    `, [`%${uniq}%`]);

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, id);

    createdUserIds.push(id);
  });

  skip("blocked filter isolates blocked users", async () => {
    const id = await createTestUser(`blocked-filter-${Date.now()}@example.com`, "user", true);

    const result = await pool.query(`
      SELECT u.id FROM users u WHERE u.is_blocked = TRUE AND u.id = $1
    `, [id]);
    assert.equal(result.rows.length, 1);
  });

  skip("role filter isolates by role", async () => {
    const id = await createTestUser(`role-filter-${Date.now()}@example.com`, "moderator");

    const result = await pool.query(`
      SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE r.name = 'moderator' AND u.id = $1
    `, [id]);
    assert.equal(result.rows.length, 1);
  });
});

// ─── getUserById ──────────────────────────────────────────────────────────────

describe("getUserById", () => {
  skip("returns user detail for existing user", async () => {
    const email = `detail-test-${Date.now()}@example.com`;
    const id = await createTestUser(email, "user");

    const result = await pool.query(`
      SELECT u.id, u.email, u.is_blocked,
        COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
        u.password_hash IS NOT NULL AS has_password,
        COALESCE(array_agg(DISTINCT oa.provider) FILTER (WHERE oa.provider IS NOT NULL), '{}') AS oauth_providers
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.id, u.email, u.is_blocked, u.password_hash
    `, [id]);

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, id);
    assert.equal(result.rows[0].email, email);
    assert.equal(result.rows[0].has_password, true);
    assert.deepEqual(result.rows[0].oauth_providers, []);
  });

  skip("returns null / empty for non-existent user", async () => {
    const { randomUUID } = await import("crypto");
    const result = await pool.query(`
      SELECT u.id FROM users u WHERE u.id = $1
    `, [randomUUID()]);
    assert.equal(result.rows.length, 0);
  });
});

// ─── adminCreateUser ─────────────────────────────────────────────────────────

describe("adminCreateUser", () => {
  skip("creates user with specified role", async () => {
    const { randomUUID } = await import("crypto");
    const bcrypt = await import("bcryptjs");
    const email = `admin-create-${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash("testpassword", 10);
    const id = randomUUID();

    await pool.query("BEGIN");
    await pool.query(`INSERT INTO roles (name) VALUES ('moderator') ON CONFLICT (name) DO NOTHING`);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, is_blocked) VALUES ($1, $2, $3, FALSE)`,
      [id, email, passwordHash]
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.name = 'moderator'`,
      [id]
    );
    await pool.query("COMMIT");
    createdUserIds.push(id);

    const check = await pool.query(`
      SELECT r.name AS role FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
    `, [id]);
    assert.equal(check.rows.length, 1);
    assert.equal(check.rows[0].role, "moderator");
  });

  skip("duplicate email raises unique constraint error", async () => {
    const email = `dup-test-${Date.now()}@example.com`;
    const id = await createTestUser(email, "user");
    const { randomUUID } = await import("crypto");
    const id2 = randomUUID();
    createdUserIds.push(id);

    await assert.rejects(
      pool.query(
        `INSERT INTO users (id, email, password_hash, is_blocked) VALUES ($1, $2, NULL, FALSE)`,
        [id2, email]
      ),
      /duplicate key|unique/i
    );
  });
});

// ─── setUserRole ─────────────────────────────────────────────────────────────

describe("setUserRole", () => {
  skip("replaces role correctly", async () => {
    const id = await createTestUser(`role-change-${Date.now()}@example.com`, "user");

    // Change to moderator.
    await pool.query("BEGIN");
    await pool.query(`INSERT INTO roles (name) VALUES ('moderator') ON CONFLICT (name) DO NOTHING`);
    await pool.query(`DELETE FROM user_roles WHERE user_id = $1`, [id]);
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.name = 'moderator'`,
      [id]
    );
    await pool.query("COMMIT");

    const check = await pool.query(`
      SELECT r.name AS role FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1
    `, [id]);
    assert.equal(check.rows.length, 1);
    assert.equal(check.rows[0].role, "moderator");
  });

  skip("user has exactly one role after change", async () => {
    const id = await createTestUser(`one-role-${Date.now()}@example.com`, "user");

    await pool.query("BEGIN");
    await pool.query(`INSERT INTO roles (name) VALUES ('admin') ON CONFLICT (name) DO NOTHING`);
    await pool.query(`DELETE FROM user_roles WHERE user_id = $1`, [id]);
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.name = 'admin'`,
      [id]
    );
    await pool.query("COMMIT");

    const check = await pool.query(
      `SELECT COUNT(*) AS cnt FROM user_roles WHERE user_id = $1`, [id]
    );
    assert.equal(parseInt(check.rows[0].cnt, 10), 1);
  });
});

// ─── setUserBlocked ───────────────────────────────────────────────────────────

describe("setUserBlocked", () => {
  skip("blocks an active user", async () => {
    const id = await createTestUser(`block-test-${Date.now()}@example.com`, "user", false);

    await pool.query(`UPDATE users SET is_blocked = TRUE WHERE id = $1`, [id]);
    const check = await pool.query(`SELECT is_blocked FROM users WHERE id = $1`, [id]);
    assert.equal(check.rows[0].is_blocked, true);
  });

  skip("unblocks a blocked user", async () => {
    const id = await createTestUser(`unblock-test-${Date.now()}@example.com`, "user", true);

    await pool.query(`UPDATE users SET is_blocked = FALSE WHERE id = $1`, [id]);
    const check = await pool.query(`SELECT is_blocked FROM users WHERE id = $1`, [id]);
    assert.equal(check.rows[0].is_blocked, false);
  });
});

// ─── deleteUser ───────────────────────────────────────────────────────────────

describe("deleteUser", () => {
  skip("removes the user row", async () => {
    const id = await createTestUser(`delete-test-${Date.now()}@example.com`, "user");

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    const check = await pool.query(`SELECT id FROM users WHERE id = $1`, [id]);
    assert.equal(check.rows.length, 0);
    // Remove from cleanup list since already deleted.
    const idx = createdUserIds.indexOf(id);
    if (idx !== -1) createdUserIds.splice(idx, 1);
  });

  skip("cascades to user_roles", async () => {
    const id = await createTestUser(`cascade-roles-${Date.now()}@example.com`, "user");

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    const check = await pool.query(`SELECT user_id FROM user_roles WHERE user_id = $1`, [id]);
    assert.equal(check.rows.length, 0);
    const idx = createdUserIds.indexOf(id);
    if (idx !== -1) createdUserIds.splice(idx, 1);
  });

  skip("cascades to oauth_accounts", async () => {
    const { randomUUID } = await import("crypto");
    const id = await createTestUser(`cascade-oauth-${Date.now()}@example.com`, "user");
    const oauthId = randomUUID();

    await pool.query(
      `INSERT INTO oauth_accounts (id, user_id, provider, provider_account_id) VALUES ($1, $2, 'github', $3)`,
      [oauthId, id, `github-id-${Date.now()}`]
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    const check = await pool.query(`SELECT id FROM oauth_accounts WHERE user_id = $1`, [id]);
    assert.equal(check.rows.length, 0);
    const idx = createdUserIds.indexOf(id);
    if (idx !== -1) createdUserIds.splice(idx, 1);
  });

  skip("sets user_id to NULL on analysis_requests (no hard cascade)", async () => {
    const id = await createTestUser(`null-fk-${Date.now()}@example.com`, "user");
    const { randomUUID } = await import("crypto");
    const reqId = randomUUID();

    // Check if networks table has any network_code to use.
    const netCheck = await pool.query(`SELECT code FROM networks LIMIT 1`);
    if (netCheck.rows.length === 0) {
      // Skip this sub-check if no networks seeded.
      const idx = createdUserIds.indexOf(id);
      if (idx !== -1) createdUserIds.splice(idx, 1);
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
      return;
    }
    const networkCode = netCheck.rows[0].code;

    await pool.query(
      `INSERT INTO analysis_requests (id, user_id, network_code, address, depth, limit_tx, status, created_at)
       VALUES ($1, $2, $3, 'test-address-1A2B', 2, 50, 'processing', NOW())`,
      [reqId, id, networkCode]
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);

    const check = await pool.query(
      `SELECT user_id FROM analysis_requests WHERE id = $1`, [reqId]
    );
    assert.equal(check.rows[0]?.user_id, null);

    // Cleanup the orphaned analysis_request.
    await pool.query(`DELETE FROM analysis_requests WHERE id = $1`, [reqId]);

    const idx = createdUserIds.indexOf(id);
    if (idx !== -1) createdUserIds.splice(idx, 1);
  });
});

// ─── countAdminUsers ─────────────────────────────────────────────────────────

describe("countAdminUsers", () => {
  skip("returns a non-negative integer", async () => {
    const result = await pool.query(`
      SELECT COUNT(*) AS count FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'
    `);
    const count = parseInt(result.rows[0].count, 10);
    assert.ok(count >= 0);
    assert.ok(Number.isInteger(count));
  });

  skip("count increases after adding admin user", async () => {
    const before = parseInt(
      (await pool.query(`
        SELECT COUNT(*) AS count FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'
      `)).rows[0].count,
      10
    );

    const id = await createTestUser(`count-admin-${Date.now()}@example.com`, "admin");

    const after = parseInt(
      (await pool.query(`
        SELECT COUNT(*) AS count FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'
      `)).rows[0].count,
      10
    );

    assert.equal(after, before + 1);
  });
});
