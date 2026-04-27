import "server-only";

import { Pool, type QueryResultRow } from "pg";
import { strongestRole, type Role } from "@/lib/rbac";

let pool: Pool | null = null;

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  return databaseUrl;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl() });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
) {
  return getPool().query<T>(text, values);
}

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  isBlocked: boolean;
  role: Role;
}

interface UserRoleRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string | null;
  is_blocked: boolean;
  roles: string[] | null;
}

function rowToAuthUser(row: UserRoleRow): AuthUserRecord | null {
  const role = strongestRole(row.roles ?? []);
  if (!role) return null;

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    isBlocked: row.is_blocked,
    role,
  };
}

export async function findUserByEmail(
  email: string
): Promise<AuthUserRecord | null> {
  const result = await query<UserRoleRow>(
    `
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.is_blocked,
        COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE lower(u.email) = lower($1)
      GROUP BY u.id, u.email, u.password_hash, u.is_blocked
      LIMIT 1
    `,
    [email]
  );

  const row = result.rows[0];
  return row ? rowToAuthUser(row) : null;
}

export async function createUser(
  email: string,
  passwordHash: string
): Promise<{ id: string; email: string }> {
  const { randomUUID } = await import("crypto");
  const id = randomUUID();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "INSERT INTO roles (name) VALUES ('user') ON CONFLICT (name) DO NOTHING"
    );

    await client.query(
      `INSERT INTO users (id, email, password_hash, is_blocked)
       VALUES ($1, $2, $3, FALSE)`,
      [id, email, passwordHash]
    );

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'user'`,
      [id]
    );

    await client.query("COMMIT");
    return { id, email };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Analysis history types ───────────────────────────────────────────────────

export interface HistoryItem {
  request_id: string;
  result_id: string;
  address: string;
  network_code: string;
  risk_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  scoring_method: string;
  model_version: string;
  status: string;
  analyzed_at: string;
  user_id: string | null;
  user_email: string | null;
}

export interface HistoryNode {
  address: string;
  depth: number;
  is_root: boolean;
  is_flagged: boolean;
  flag_types: string[] | null;
}

export interface HistoryEdge {
  from_address: string;
  to_address: string;
  tx_count: number;
  amount: string;
  first_seen: string | null;
  last_seen: string | null;
}

export interface AnalysisDetail extends HistoryItem {
  flag_type: string | null;
  nodes_count: number;
  edges_count: number;
  factors_json: unknown;
  nodes: HistoryNode[];
  edges: HistoryEdge[];
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface HistoryRow extends QueryResultRow {
  request_id: string;
  result_id: string;
  address: string;
  network_code: string;
  risk_score: string;
  risk_level: string;
  scoring_method: string | null;
  model_version: string | null;
  status: string;
  analyzed_at: Date;
  user_id: string | null;
  user_email: string | null;
}

interface AnalysisDetailRow extends HistoryRow {
  flag_type: string | null;
  factors_json: unknown;
}

interface NodeRow extends QueryResultRow {
  address: string;
  depth: number;
  is_root: boolean;
  is_flagged: boolean;
  flag_types: string[] | null;
}

interface EdgeRow extends QueryResultRow {
  from_address: string;
  to_address: string;
  tx_count: number;
  amount: string;
  first_seen: Date | null;
  last_seen: Date | null;
}

function rowToHistoryItem(row: HistoryRow): HistoryItem {
  return {
    request_id: row.request_id,
    result_id: row.result_id,
    address: row.address,
    network_code: row.network_code,
    risk_score: parseFloat(row.risk_score),
    risk_level: row.risk_level as "LOW" | "MEDIUM" | "HIGH",
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

// userId = null → admin path (no ownership filter)
export async function getAnalysisHistory(
  userId: string | null,
  limit: number,
  offset: number
): Promise<{ items: HistoryItem[]; total: number }> {
  const params: unknown[] = [limit, offset];
  const ownerFilter = userId ? `AND ar.user_id = $3` : "";
  if (userId) params.push(userId);

  const [listResult, countResult] = await Promise.all([
    query<HistoryRow>(
      `SELECT
         ar.id            AS request_id,
         res.id           AS result_id,
         res.address,
         res.network_code,
         res.risk_score,
         res.risk_level,
         (res.factors_json->>'scoring_method') AS scoring_method,
         res.model_version,
         ar.status,
         res.analyzed_at,
         ar.user_id,
         u.email          AS user_email
       FROM analysis_requests ar
       JOIN analysis_results res ON res.request_id = ar.id
       LEFT JOIN users u ON u.id = ar.user_id
       WHERE ar.status = 'completed'
       ${ownerFilter}
       ORDER BY res.analyzed_at DESC
       LIMIT $1 OFFSET $2`,
      params
    ),
    query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM analysis_requests ar
       JOIN analysis_results res ON res.request_id = ar.id
       WHERE ar.status = 'completed'
       ${ownerFilter}`,
      userId ? [userId] : []
    ),
  ]);

  return {
    items: listResult.rows.map(rowToHistoryItem),
    total: parseInt(countResult.rows[0]?.total ?? "0", 10),
  };
}

// resultId is analysis_results.id; userId = null → admin (no ownership check)
export async function getAnalysisResult(
  resultId: string,
  userId: string | null
): Promise<AnalysisDetail | null> {
  const ownerFilter = userId ? `AND ar.user_id = $2` : "";
  const params: unknown[] = [resultId];
  if (userId) params.push(userId);

  const detailResult = await query<AnalysisDetailRow>(
    `SELECT
       ar.id            AS request_id,
       res.id           AS result_id,
       res.address,
       res.network_code,
       res.risk_score,
       res.risk_level,
       (res.factors_json->>'scoring_method') AS scoring_method,
       res.model_version,
       ar.status,
       res.analyzed_at,
       ar.user_id,
       u.email          AS user_email,
       (res.factors_json->>'flag_type')      AS flag_type,
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
    query<NodeRow>(
      `SELECT address, depth, is_root, is_flagged, flag_types
       FROM address_nodes
       WHERE result_id = $1
       ORDER BY depth, address`,
      [resultId]
    ),
    query<EdgeRow>(
      `SELECT from_address, to_address, tx_count, amount, first_seen, last_seen
       FROM graph_edges
       WHERE result_id = $1
       ORDER BY tx_count DESC`,
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
    nodes: nodesResult.rows.map((n) => ({
      address: n.address,
      depth: n.depth,
      is_root: n.is_root,
      is_flagged: n.is_flagged,
      flag_types: n.flag_types ?? [],
    })),
    edges: edgesResult.rows.map((e) => ({
      from_address: e.from_address,
      to_address: e.to_address,
      tx_count: e.tx_count,
      amount: e.amount,
      first_seen: e.first_seen instanceof Date
        ? e.first_seen.toISOString()
        : e.first_seen,
      last_seen: e.last_seen instanceof Date
        ? e.last_seen.toISOString()
        : e.last_seen,
    })),
  };
}

export async function findUserById(id: string): Promise<AuthUserRecord | null> {
  const result = await query<UserRoleRow>(
    `
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.is_blocked,
        COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = $1
      GROUP BY u.id, u.email, u.password_hash, u.is_blocked
      LIMIT 1
    `,
    [id]
  );

  const row = result.rows[0];
  return row ? rowToAuthUser(row) : null;
}
