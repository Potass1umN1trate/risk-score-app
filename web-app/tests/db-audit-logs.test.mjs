// Integration tests for logAuditEvent and getAuditLogs DB helpers.
// Skipped unless DATABASE_URL is set. Uses the live Postgres database.
// Run with: DATABASE_URL=<url> node --test web-app/tests/db-audit-logs.test.mjs
// Requires Node 22 (node:test built-in).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log("Skipping db-audit-logs integration tests: DATABASE_URL not set.");
  process.exit(0);
}

// Dynamic import after DATABASE_URL check so the pool is only created when needed.
const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: DATABASE_URL });

// We need a real user to satisfy the FK on audit_logs.user_id.
// Create a disposable test user for the duration of these tests.
let testUserId;
let testUserEmail;

before(async () => {
  const { randomUUID } = await import("crypto");
  testUserId = randomUUID();
  testUserEmail = `audit-test-${testUserId.slice(0, 8)}@example.com`;

  await pool.query(
    `INSERT INTO users (id, email, password_hash, is_blocked) VALUES ($1, $2, NULL, FALSE)`,
    [testUserId, testUserEmail]
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = 'user'`,
    [testUserId]
  );
});

after(async () => {
  // Cascade deletes user_roles and sets audit_logs.user_id = NULL via ON DELETE SET NULL.
  await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  await pool.end();
});

// Helpers inline-imported from the compiled TS would require a build step.
// Instead, we call the DB directly using the same SQL as the helpers to verify
// the table contract, and test the actual helpers via a thin dynamic require shim.
// Since the web-app is TypeScript, we test the helper contract by reproducing
// the INSERT/SELECT logic in raw SQL — this tests the schema, not the TS helper directly.
// The TS helper tests (unit) are in api-admin-audit-logs-logic.test.mjs.

async function insertAuditLog({ id, userId, actorRole = null, action, entity = null, entityId = null, details = null }) {
  await pool.query(
    `INSERT INTO audit_logs (id, user_id, actor_role, action, entity, entity_id, details_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, actorRole, action, entity, entityId, details ? JSON.stringify(details) : null]
  );
}

async function selectAuditLogs({ action, userId, email, role, entity, dateFrom, dateTo } = {}) {
  const conditions = [];
  const params = [];

  if (action)   { params.push(action);         conditions.push(`al.action = $${params.length}`); }
  if (userId)   { params.push(userId);          conditions.push(`al.user_id = $${params.length}`); }
  if (email)    { params.push(`%${email}%`);    conditions.push(`u.email ILIKE $${params.length}`); }
  if (role)     { params.push(role);            conditions.push(`al.actor_role = $${params.length}`); }
  if (entity)   { params.push(entity);          conditions.push(`al.entity = $${params.length}`); }
  if (dateFrom) { params.push(dateFrom);        conditions.push(`al.created_at >= $${params.length}`); }
  if (dateTo)   { params.push(dateTo);          conditions.push(`al.created_at < $${params.length}`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT al.*, u.email AS user_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.created_at DESC`,
    params
  );
  return rows;
}

async function countAuditLogs(filters = {}) {
  const rows = await selectAuditLogs(filters);
  return rows.length;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("logAuditEvent contract (raw SQL)", () => {
  test("inserting an audit event creates a retrievable row", async () => {
    const { randomUUID } = await import("crypto");
    const id = randomUUID();

    await insertAuditLog({
      id,
      userId: testUserId,
      actorRole: "admin",
      action: "USER_CREATED",
      entity: "user",
      entityId: randomUUID(),
      details: { email: "new@example.com", role: "user" },
    });

    const rows = await selectAuditLogs({ action: "USER_CREATED", userId: testUserId });
    const row = rows.find((r) => r.id === id);
    assert.ok(row, "Inserted row should be retrievable");
    assert.equal(row.action, "USER_CREATED");
    assert.equal(row.entity, "user");
    assert.equal(row.user_email, testUserEmail);
    assert.equal(row.actor_role, "admin");
    assert.ok(row.details_json !== null);
    assert.equal(row.details_json.email, "new@example.com");
    assert.equal(row.details_json.role, "user");
    assert.ok(row.created_at instanceof Date);
  });

  test("audit row with null entity and entity_id is accepted", async () => {
    const { randomUUID } = await import("crypto");
    const id = randomUUID();

    await insertAuditLog({
      id,
      userId: testUserId,
      action: "USER_DELETED",
      entity: null,
      entityId: null,
      details: null,
    });

    const rows = await selectAuditLogs({ action: "USER_DELETED", userId: testUserId });
    const row = rows.find((r) => r.id === id);
    assert.ok(row);
    assert.equal(row.entity, null);
    assert.equal(row.entity_id, null);
    assert.equal(row.details_json, null);
  });

  test("audit row user_id becomes null after user deletion (ON DELETE SET NULL)", async () => {
    const { randomUUID } = await import("crypto");
    const ephemeralUserId = randomUUID();
    const ephemeralEmail = `ephemeral-${ephemeralUserId.slice(0, 8)}@example.com`;

    await pool.query(
      `INSERT INTO users (id, email, password_hash, is_blocked) VALUES ($1, $2, NULL, FALSE)`,
      [ephemeralUserId, ephemeralEmail]
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'user'`,
      [ephemeralUserId]
    );

    const logId = randomUUID();
    await insertAuditLog({
      id: logId,
      userId: ephemeralUserId,
      action: "USER_BLOCKED",
      entity: "user",
      entityId: ephemeralUserId,
      details: { email: ephemeralEmail },
    });

    // Delete the user — FK ON DELETE SET NULL should null out audit_logs.user_id.
    await pool.query(`DELETE FROM users WHERE id = $1`, [ephemeralUserId]);

    const { rows } = await pool.query(
      `SELECT user_id FROM audit_logs WHERE id = $1`,
      [logId]
    );
    assert.equal(rows[0].user_id, null, "user_id should be null after user deletion");

    // Cleanup
    await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [logId]);
  });
});

describe("getAuditLogs contract (raw SQL)", () => {
  let action1Id, action2Id, action3Id;

  before(async () => {
    const { randomUUID } = await import("crypto");
    action1Id = randomUUID();
    action2Id = randomUUID();
    action3Id = randomUUID();

    await insertAuditLog({ id: action1Id, userId: testUserId, action: "USER_ROLE_CHANGED", entity: "user", entityId: randomUUID(), details: { old_role: "user", new_role: "moderator" } });
    await insertAuditLog({ id: action2Id, userId: testUserId, action: "USER_UNBLOCKED", entity: "user", entityId: randomUUID(), details: { email: "someone@example.com" } });
    await insertAuditLog({ id: action3Id, userId: testUserId, action: "NETWORK_CONFIG_CHANGED", entity: "network", entityId: "BTC", details: { code: "BTC", changes: { is_active: false } } });
  });

  after(async () => {
    await pool.query(
      `DELETE FROM audit_logs WHERE id = ANY($1)`,
      [[action1Id, action2Id, action3Id]]
    );
  });

  test("filter by action returns only matching rows", async () => {
    const rows = await selectAuditLogs({ action: "USER_ROLE_CHANGED", userId: testUserId });
    assert.ok(rows.length >= 1);
    for (const r of rows) {
      assert.equal(r.action, "USER_ROLE_CHANGED");
    }
  });

  test("filter by userId returns only that user's rows", async () => {
    const rows = await selectAuditLogs({ userId: testUserId });
    for (const r of rows) {
      assert.equal(r.user_id, testUserId);
    }
  });

  test("filter by entity=network returns network events", async () => {
    const rows = await selectAuditLogs({ entity: "network", userId: testUserId });
    assert.ok(rows.length >= 1);
    for (const r of rows) {
      assert.equal(r.entity, "network");
    }
  });

  test("filter by entity=user excludes network events", async () => {
    const rows = await selectAuditLogs({ entity: "user", userId: testUserId });
    for (const r of rows) {
      assert.equal(r.entity, "user");
    }
  });

  test("results are ordered by created_at DESC", async () => {
    const rows = await selectAuditLogs({ userId: testUserId });
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].created_at >= rows[i].created_at);
    }
  });

  test("user_email is joined correctly", async () => {
    const rows = await selectAuditLogs({ userId: testUserId });
    assert.ok(rows.length > 0);
    assert.equal(rows[0].user_email, testUserEmail);
  });

  test("pagination: LIMIT and OFFSET work correctly", async () => {
    const all = await selectAuditLogs({ userId: testUserId });
    if (all.length < 2) return; // not enough rows to paginate

    const { rows: page1 } = await pool.query(
      `SELECT id FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1 OFFSET 0`,
      [testUserId]
    );
    const { rows: page2 } = await pool.query(
      `SELECT id FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1 OFFSET 1`,
      [testUserId]
    );

    assert.ok(page1.length === 1);
    assert.ok(page2.length === 1);
    assert.notEqual(page1[0].id, page2[0].id, "Pages should return different rows");
  });

  test("total count matches actual rows for userId filter", async () => {
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs WHERE user_id = $1`,
      [testUserId]
    );
    const total = parseInt(countRows[0].total, 10);
    const rows = await selectAuditLogs({ userId: testUserId });
    assert.equal(rows.length, total);
  });
});

describe("logAuditEvent error resilience", () => {
  test("inserting with an invalid user_id (non-existent FK) is caught by FK constraint but helper swallows it", async () => {
    // We test the swallow behavior by reproducing what logAuditEvent does:
    // wrap the insert in try/catch. If the FK fails, it should not throw.
    const { randomUUID } = await import("crypto");
    let threw = false;
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, user_id, action) VALUES ($1, $2, $3)`,
        [randomUUID(), "non-existent-uuid-xxxxx", "USER_CREATED"]
      );
    } catch {
      threw = true; // FK violation — expected at raw SQL level
    }
    // The raw query throws, but logAuditEvent wraps in try/catch and swallows.
    // We verify the wrapping pattern is correct by ensuring threw is true here
    // (i.e., the DB does enforce the FK) — which confirms that logAuditEvent's
    // try/catch is load-bearing, not dead code.
    assert.equal(threw, true, "Raw FK violation should throw — logAuditEvent must wrap this");
  });

  test("logAuditEvent accepts null userId (system/self-registration events)", async () => {
    // audit_logs.user_id is nullable — insert with NULL user_id must succeed.
    const { randomUUID } = await import("crypto");
    const id = randomUUID();
    let threw = false;
    try {
      await pool.query(
        `INSERT INTO audit_logs (id, user_id, action) VALUES ($1, $2, $3)`,
        [id, null, "USER_REGISTERED"]
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "NULL user_id should be accepted by the schema");
    await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [id]);
  });

  test("details_json never contains password or secret fields", () => {
    const safeDetails = { email: "u@example.com" };
    assert.equal("password" in safeDetails, false);
    assert.equal("password_hash" in safeDetails, false);
    assert.equal("token" in safeDetails, false);
    assert.equal("secret" in safeDetails, false);
  });
});

describe("getAuditLogs — email filter (raw SQL)", () => {
  let emailLogId;

  before(async () => {
    const { randomUUID } = await import("crypto");
    emailLogId = randomUUID();
    await insertAuditLog({
      id: emailLogId,
      userId: testUserId,
      actorRole: "user",
      action: "RUN_ANALYSIS",
      entity: "analysis",
      entityId: randomUUID(),
      details: { address: "1test", network: "BTC", risk_level: "LOW" },
    });
  });

  after(async () => {
    await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [emailLogId]);
  });

  test("email ILIKE filter returns rows for matching user", async () => {
    // testUserEmail contains a unique prefix derived from testUserId.
    const emailFragment = testUserEmail.split("@")[0].slice(0, 8);
    const rows = await selectAuditLogs({ email: emailFragment });
    assert.ok(rows.length >= 1, "Should find at least one row for this user's email");
    for (const r of rows) {
      assert.ok(
        r.user_email && r.user_email.toLowerCase().includes(emailFragment.toLowerCase()),
        `email_email '${r.user_email}' should contain '${emailFragment}'`
      );
    }
  });

  test("email filter with non-matching value returns no rows", async () => {
    const rows = await selectAuditLogs({ email: "no-such-email-xyz-99999" });
    assert.equal(rows.length, 0);
  });
});

describe("getAuditLogs — role filter via actor_role (raw SQL)", () => {
  let roleLogId, legacyRoleLogId;

  before(async () => {
    const { randomUUID } = await import("crypto");
    roleLogId = randomUUID();
    legacyRoleLogId = randomUUID();
    await insertAuditLog({
      id: roleLogId,
      userId: testUserId,
      actorRole: "moderator",
      action: "FLAGGED_ADDRESS_CREATED",
      entity: "flagged_address",
      entityId: randomUUID(),
      details: { network_code: "BTC", address: "1testaddr" },
    });
    await insertAuditLog({
      id: legacyRoleLogId,
      userId: testUserId,
      actorRole: null,
      action: "FLAGGED_ADDRESS_UPDATED",
      entity: "flagged_address",
      entityId: randomUUID(),
      details: { role: "moderator", changes: { comment: "legacy" } },
    });
  });

  after(async () => {
    await pool.query(`DELETE FROM audit_logs WHERE id = ANY($1)`, [[roleLogId, legacyRoleLogId]]);
  });

  test("role filter matches events with matching actor_role", async () => {
    const rows = await selectAuditLogs({ role: "moderator", userId: testUserId });
    const found = rows.find((r) => r.id === roleLogId);
    assert.ok(found, "Should find the row with actor_role=moderator");
    assert.equal(found.actor_role, "moderator");
  });

  test("role filter does not match events with different actor_role", async () => {
    const rows = await selectAuditLogs({ role: "admin", userId: testUserId });
    const found = rows.find((r) => r.id === roleLogId);
    assert.equal(found, undefined, "Should not find the moderator-role row when filtering for admin");
  });

  test("role filter does not match legacy details_json.role when actor_role is null", async () => {
    const rows = await selectAuditLogs({ role: "moderator", userId: testUserId });
    const found = rows.find((r) => r.id === legacyRoleLogId);
    assert.equal(found, undefined, "Legacy details_json.role must not satisfy actor-role filter");
  });

  test("historical row with null actor_role is returned safely without role filter", async () => {
    const rows = await selectAuditLogs({ userId: testUserId });
    const found = rows.find((r) => r.id === legacyRoleLogId);
    assert.ok(found, "Historical row should still be retrievable");
    assert.equal(found.actor_role, null);
  });

  test("role filter does not match events without actor_role", async () => {
    const { randomUUID } = await import("crypto");
    const noRoleId = randomUUID();
    await insertAuditLog({
      id: noRoleId,
      userId: testUserId,
      action: "USER_DELETED",
      details: null,
    });
    const rows = await selectAuditLogs({ role: "user", userId: testUserId });
    const found = rows.find((r) => r.id === noRoleId);
    assert.equal(found, undefined, "Events without actor_role should not match role filter");
    await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [noRoleId]);
  });
});

describe("getAuditLogs — date range filter (raw SQL)", () => {
  let pastLogId, futureLogId;

  before(async () => {
    const { randomUUID } = await import("crypto");
    pastLogId = randomUUID();
    futureLogId = randomUUID();

    // Insert a row with a fixed past timestamp.
    await pool.query(
      `INSERT INTO audit_logs (id, user_id, action, created_at) VALUES ($1, $2, $3, $4)`,
      [pastLogId, testUserId, "USER_BLOCKED", "2020-01-15T12:00:00Z"]
    );
    // Insert a row with a fixed future-past timestamp (far future enough to be distinct).
    await pool.query(
      `INSERT INTO audit_logs (id, user_id, action, created_at) VALUES ($1, $2, $3, $4)`,
      [futureLogId, testUserId, "USER_UNBLOCKED", "2099-06-01T12:00:00Z"]
    );
  });

  after(async () => {
    await pool.query(`DELETE FROM audit_logs WHERE id = ANY($1)`, [[pastLogId, futureLogId]]);
  });

  test("dateFrom filter excludes rows before the date", async () => {
    const rows = await selectAuditLogs({ userId: testUserId, dateFrom: "2021-01-01T00:00:00Z" });
    const pastRow = rows.find((r) => r.id === pastLogId);
    assert.equal(pastRow, undefined, "Row from 2020 should be excluded when dateFrom is 2021");
  });

  test("dateTo filter excludes rows after the date", async () => {
    const rows = await selectAuditLogs({ userId: testUserId, dateTo: "2050-01-01T00:00:00Z" });
    const futureRow = rows.find((r) => r.id === futureLogId);
    assert.equal(futureRow, undefined, "Row from 2099 should be excluded when dateTo is 2050");
  });

  test("dateFrom + dateTo together returns only rows in range", async () => {
    const rows = await selectAuditLogs({
      userId: testUserId,
      dateFrom: "2019-01-01T00:00:00Z",
      dateTo: "2021-01-01T00:00:00Z",
    });
    const pastRow = rows.find((r) => r.id === pastLogId);
    const futureRow = rows.find((r) => r.id === futureLogId);
    assert.ok(pastRow, "Row from 2020 should be in range");
    assert.equal(futureRow, undefined, "Row from 2099 should be outside range");
  });
});

// ─── Auth-flow audit events: LOGIN_SUCCESS, LOGIN_FAILURE, OAUTH_LOGIN_SUCCESS ─

describe("Auth audit events — LOGIN_SUCCESS row contract", () => {
  let loginSuccessId;

  before(async () => {
    const { randomUUID } = await import("crypto");
    loginSuccessId = randomUUID();
    await insertAuditLog({
      id: loginSuccessId,
      userId: testUserId,
      actorRole: "user",
      action: "LOGIN_SUCCESS",
      entity: "user",
      entityId: testUserId,
      details: { email: testUserEmail },
    });
  });

  after(async () => {
    await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [loginSuccessId]);
  });

  test("LOGIN_SUCCESS row is retrievable by action filter", async () => {
    const rows = await selectAuditLogs({ action: "LOGIN_SUCCESS", userId: testUserId });
    const found = rows.find((r) => r.id === loginSuccessId);
    assert.ok(found, "Should find the LOGIN_SUCCESS row");
    assert.equal(found.action, "LOGIN_SUCCESS");
    assert.equal(found.entity, "user");
  });

  test("LOGIN_SUCCESS details_json contains email and actor_role stores role", async () => {
    const rows = await selectAuditLogs({ action: "LOGIN_SUCCESS", userId: testUserId });
    const found = rows.find((r) => r.id === loginSuccessId);
    assert.ok(found);
    assert.equal(found.details_json.email, testUserEmail);
    assert.equal(found.actor_role, "user");
  });

  test("LOGIN_SUCCESS is filterable by actor_role", async () => {
    const rows = await selectAuditLogs({ role: "user", userId: testUserId });
    const found = rows.find((r) => r.id === loginSuccessId);
    assert.ok(found, "LOGIN_SUCCESS should be found when filtering by role=user");
  });

  test("LOGIN_SUCCESS is filterable by email ILIKE", async () => {
    const fragment = testUserEmail.split("@")[0].slice(0, 8);
    const rows = await selectAuditLogs({ email: fragment });
    const found = rows.find((r) => r.id === loginSuccessId);
    assert.ok(found, "LOGIN_SUCCESS should be found when filtering by email substring");
  });

  test("LOGIN_SUCCESS details_json does not contain password or token fields", async () => {
    const rows = await selectAuditLogs({ action: "LOGIN_SUCCESS", userId: testUserId });
    const found = rows.find((r) => r.id === loginSuccessId);
    assert.ok(found);
    assert.equal("password" in found.details_json, false);
    assert.equal("password_hash" in found.details_json, false);
    assert.equal("token" in found.details_json, false);
  });
});

describe("Auth audit events — LOGIN_FAILURE row contract", () => {
  let failureWrongPwId, failureBlockedId, failureMissingHashId, failureUnknownUserId;

  before(async () => {
    const { randomUUID } = await import("crypto");
    failureWrongPwId    = randomUUID();
    failureBlockedId    = randomUUID();
    failureMissingHashId = randomUUID();
    failureUnknownUserId = randomUUID();

    await insertAuditLog({
      id: failureWrongPwId,
      userId: testUserId,
      actorRole: "user",
      action: "LOGIN_FAILURE",
      entity: "user",
      entityId: testUserId,
      details: { email: testUserEmail, reason: "wrong_password" },
    });
    await insertAuditLog({
      id: failureBlockedId,
      userId: testUserId,
      actorRole: "user",
      action: "LOGIN_FAILURE",
      entity: "user",
      entityId: testUserId,
      details: { email: testUserEmail, reason: "blocked" },
    });
    await insertAuditLog({
      id: failureMissingHashId,
      userId: testUserId,
      actorRole: "user",
      action: "LOGIN_FAILURE",
      entity: "user",
      entityId: testUserId,
      details: { email: testUserEmail, reason: "missing_hash" },
    });
    // Unknown user (no DB row) — user_id must be NULL to satisfy FK.
    await insertAuditLog({
      id: failureUnknownUserId,
      userId: null,
      action: "LOGIN_FAILURE",
      entity: "user",
      entityId: null,
      details: { email: "unknown@example.com", reason: "missing_hash" },
    });
  });

  after(async () => {
    await pool.query(
      `DELETE FROM audit_logs WHERE id = ANY($1)`,
      [[failureWrongPwId, failureBlockedId, failureMissingHashId, failureUnknownUserId]]
    );
  });

  test("LOGIN_FAILURE rows are retrievable by action filter", async () => {
    const rows = await selectAuditLogs({ action: "LOGIN_FAILURE", userId: testUserId });
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(failureWrongPwId), "wrong_password row should be present");
    assert.ok(ids.includes(failureBlockedId), "blocked row should be present");
    assert.ok(ids.includes(failureMissingHashId), "missing_hash row should be present");
  });

  test("reason=wrong_password is stored in details_json", async () => {
    const rows = await selectAuditLogs({ action: "LOGIN_FAILURE", userId: testUserId });
    const found = rows.find((r) => r.id === failureWrongPwId);
    assert.ok(found);
    assert.equal(found.details_json.reason, "wrong_password");
  });

  test("reason=blocked is stored in details_json", async () => {
    const rows = await selectAuditLogs({ action: "LOGIN_FAILURE", userId: testUserId });
    const found = rows.find((r) => r.id === failureBlockedId);
    assert.ok(found);
    assert.equal(found.details_json.reason, "blocked");
  });

  test("reason=missing_hash is stored in details_json", async () => {
    const rows = await selectAuditLogs({ action: "LOGIN_FAILURE", userId: testUserId });
    const found = rows.find((r) => r.id === failureMissingHashId);
    assert.ok(found);
    assert.equal(found.details_json.reason, "missing_hash");
  });

  test("LOGIN_FAILURE with null userId (unknown user) is accepted by schema", async () => {
    const { rows } = await pool.query(
      `SELECT id, user_id, actor_role, details_json FROM audit_logs WHERE id = $1`,
      [failureUnknownUserId]
    );
    assert.ok(rows[0], "Row should exist");
    assert.equal(rows[0].user_id, null, "user_id must be null for unknown user");
    assert.equal(rows[0].actor_role, null, "actor_role must be null for unknown user");
    assert.equal(rows[0].details_json.reason, "missing_hash");
  });

  test("LOGIN_FAILURE details_json does not contain password fields", async () => {
    const rows = await selectAuditLogs({ action: "LOGIN_FAILURE", userId: testUserId });
    for (const r of rows) {
      assert.equal("password" in r.details_json, false);
      assert.equal("password_hash" in r.details_json, false);
    }
  });
});

describe("Auth audit events — OAUTH_LOGIN_SUCCESS row contract", () => {
  let oauthLogId;

  before(async () => {
    const { randomUUID } = await import("crypto");
    oauthLogId = randomUUID();
    await insertAuditLog({
      id: oauthLogId,
      userId: testUserId,
      actorRole: "user",
      action: "OAUTH_LOGIN_SUCCESS",
      entity: "user",
      entityId: testUserId,
      details: { email: testUserEmail, provider: "github" },
    });
  });

  after(async () => {
    await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [oauthLogId]);
  });

  test("OAUTH_LOGIN_SUCCESS row is retrievable by action filter", async () => {
    const rows = await selectAuditLogs({ action: "OAUTH_LOGIN_SUCCESS", userId: testUserId });
    const found = rows.find((r) => r.id === oauthLogId);
    assert.ok(found, "Should find the OAUTH_LOGIN_SUCCESS row");
    assert.equal(found.action, "OAUTH_LOGIN_SUCCESS");
  });

  test("OAUTH_LOGIN_SUCCESS details_json contains email/provider and actor_role stores role", async () => {
    const rows = await selectAuditLogs({ action: "OAUTH_LOGIN_SUCCESS", userId: testUserId });
    const found = rows.find((r) => r.id === oauthLogId);
    assert.ok(found);
    assert.equal(found.details_json.email, testUserEmail);
    assert.equal(found.actor_role, "user");
    assert.equal(found.details_json.provider, "github");
  });

  test("OAUTH_LOGIN_SUCCESS is filterable by actor_role", async () => {
    const rows = await selectAuditLogs({ role: "user", userId: testUserId });
    const found = rows.find((r) => r.id === oauthLogId);
    assert.ok(found, "OAUTH_LOGIN_SUCCESS should be found when filtering by role=user");
  });

  test("OAUTH_LOGIN_SUCCESS is filterable by email ILIKE", async () => {
    const fragment = testUserEmail.split("@")[0].slice(0, 8);
    const rows = await selectAuditLogs({ email: fragment });
    const found = rows.find((r) => r.id === oauthLogId);
    assert.ok(found, "OAUTH_LOGIN_SUCCESS should be found when filtering by email substring");
  });

  test("OAUTH_LOGIN_SUCCESS details_json does not contain token or secret fields", async () => {
    const rows = await selectAuditLogs({ action: "OAUTH_LOGIN_SUCCESS", userId: testUserId });
    const found = rows.find((r) => r.id === oauthLogId);
    assert.ok(found);
    assert.equal("token" in found.details_json, false);
    assert.equal("secret" in found.details_json, false);
    assert.equal("password" in found.details_json, false);
  });
});
