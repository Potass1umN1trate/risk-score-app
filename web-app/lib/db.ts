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
  amount: string | null;
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
  // List query: $1=limit, $2=offset, $3=userId (only when userId set)
  const listParams: unknown[] = [limit, offset];
  const listFilter = userId ? `AND ar.user_id = $3` : "";
  if (userId) listParams.push(userId);

  // Count query: $1=userId (only when userId set) — separate param numbering
  const countParams: unknown[] = userId ? [userId] : [];
  const countFilter = userId ? `AND ar.user_id = $1` : "";

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
       ${listFilter}
       ORDER BY res.analyzed_at DESC
       LIMIT $1 OFFSET $2`,
      listParams
    ),
    query<{ total: string }>(
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

export async function patchAnalysisRequestUserId(
  requestId: string,
  userId: string
): Promise<void> {
  await query(
    `UPDATE analysis_requests SET user_id = $1 WHERE id = $2 AND user_id IS NULL`,
    [userId, requestId]
  );
}

export async function findOrCreateOAuthUser(
  provider: string,
  providerAccountId: string,
  email: string
): Promise<AuthUserRecord> {
  const { randomUUID } = await import("crypto");
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Check if this OAuth account already exists.
    const existingOAuth = await client.query<{ user_id: string }>(
      `SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_account_id = $2`,
      [provider, providerAccountId]
    );

    if (existingOAuth.rows.length > 0) {
      await client.query("COMMIT");
      const user = await findUserById(existingOAuth.rows[0].user_id);
      if (!user) throw new Error("OAuth account linked to missing user");
      return user;
    }

    // Check if a user with this email already exists (credentials account).
    const existingUser = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [email]
    );

    let userId: string;

    if (existingUser.rows.length > 0) {
      // Link OAuth account to existing user.
      userId = existingUser.rows[0].id;
    } else {
      // Create a new user without a password hash.
      userId = randomUUID();
      await client.query(
        `INSERT INTO roles (name) VALUES ('user') ON CONFLICT (name) DO NOTHING`
      );
      await client.query(
        `INSERT INTO users (id, email, password_hash, is_blocked) VALUES ($1, $2, NULL, FALSE)`,
        [userId, email.trim().toLowerCase()]
      );
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'user'`,
        [userId]
      );
    }

    // Always insert the OAuth account record.
    const oauthId = randomUUID();
    await client.query(
      `INSERT INTO oauth_accounts (id, user_id, provider, provider_account_id) VALUES ($1, $2, $3, $4)`,
      [oauthId, userId, provider, providerAccountId]
    );

    await client.query("COMMIT");

    const user = await findUserById(userId);
    if (!user) throw new Error("Failed to load user after OAuth provisioning");
    return user;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Flagged address types ────────────────────────────────────────────────────

export interface FlaggedAddressItem {
  id: string;
  network_id: number;
  network_code: string;
  network_name: string;
  address: string;
  risk_category_id: number;
  risk_category_code: string;
  risk_category_name: string;
  comment: string | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_at: string;
  is_active: boolean;
}

export interface FlaggedAddressFilters {
  network?: string;
  category?: string;
  search?: string;
  active?: boolean;
}

export interface ImportRecord {
  network_code: string;
  address: string;
  risk_category_code: string;
  comment?: string | null;
}

interface FlaggedAddressRow extends QueryResultRow {
  id: string;
  network_id: number;
  network_code: string;
  network_name: string;
  address: string;
  risk_category_id: number;
  risk_category_code: string;
  risk_category_name: string;
  comment: string | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_at: Date;
  is_active: boolean;
}

function rowToFlaggedAddress(row: FlaggedAddressRow): FlaggedAddressItem {
  return {
    id: row.id,
    network_id: row.network_id,
    network_code: row.network_code,
    network_name: row.network_name,
    address: row.address,
    risk_category_id: row.risk_category_id,
    risk_category_code: row.risk_category_code,
    risk_category_name: row.risk_category_name,
    comment: row.comment,
    created_by_user_id: row.created_by_user_id,
    created_by_email: row.created_by_email,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
    is_active: row.is_active,
  };
}

const FLAGGED_SELECT = `
  SELECT
    fa.id,
    fa.network_id,
    n.code    AS network_code,
    n.name    AS network_name,
    fa.address,
    fa.risk_category_id,
    rc.code   AS risk_category_code,
    rc.name   AS risk_category_name,
    fa.comment,
    fa.created_by_user_id,
    u.email   AS created_by_email,
    fa.created_at,
    fa.is_active
  FROM flagged_addresses fa
  JOIN networks n ON n.id = fa.network_id
  JOIN risk_categories rc ON rc.id = fa.risk_category_id
  LEFT JOIN users u ON u.id = fa.created_by_user_id
`;

export async function getFlaggedAddresses(
  filters: FlaggedAddressFilters,
  limit: number,
  offset: number
): Promise<{ items: FlaggedAddressItem[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.network) {
    params.push(filters.network.toUpperCase());
    conditions.push(`n.code = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category.toLowerCase());
    conditions.push(`rc.code = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`fa.address ILIKE $${params.length}`);
  }
  if (filters.active !== undefined) {
    params.push(filters.active);
    conditions.push(`fa.is_active = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const listParams = [...params, limit, offset];
  const countParams = [...params];

  const [listResult, countResult] = await Promise.all([
    query<FlaggedAddressRow>(
      `${FLAGGED_SELECT} ${where} ORDER BY fa.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    ),
    query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM flagged_addresses fa
       JOIN networks n ON n.id = fa.network_id
       JOIN risk_categories rc ON rc.id = fa.risk_category_id
       ${where}`,
      countParams
    ),
  ]);

  return {
    items: listResult.rows.map(rowToFlaggedAddress),
    total: parseInt(countResult.rows[0]?.total ?? "0", 10),
  };
}

export async function getFlaggedAddressById(
  id: string
): Promise<FlaggedAddressItem | null> {
  const result = await query<FlaggedAddressRow>(
    `${FLAGGED_SELECT} WHERE fa.id = $1`,
    [id]
  );
  const row = result.rows[0];
  return row ? rowToFlaggedAddress(row) : null;
}

export async function createFlaggedAddress(
  data: { network_code: string; address: string; risk_category_code: string; comment?: string | null },
  userId: string
): Promise<FlaggedAddressItem> {
  const { randomUUID } = await import("crypto");
  const id = randomUUID();

  const networkResult = await query<{ id: number }>(
    `SELECT id FROM networks WHERE code = $1`,
    [data.network_code.toUpperCase()]
  );
  if (!networkResult.rows[0]) {
    throw new Error(`Unknown network code: ${data.network_code}`);
  }
  const network_id = networkResult.rows[0].id;

  const categoryResult = await query<{ id: number }>(
    `SELECT id FROM risk_categories WHERE code = $1`,
    [data.risk_category_code.toLowerCase()]
  );
  if (!categoryResult.rows[0]) {
    throw new Error(`Unknown risk category code: ${data.risk_category_code}`);
  }
  const risk_category_id = categoryResult.rows[0].id;

  await query(
    `INSERT INTO flagged_addresses
       (id, network_id, address, risk_category_id, comment, created_by_user_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
    [id, network_id, data.address.trim(), risk_category_id, data.comment ?? null, userId]
  );

  const created = await getFlaggedAddressById(id);
  if (!created) throw new Error("Failed to load created flagged address");
  return created;
}

export async function updateFlaggedAddress(
  id: string,
  patch: { risk_category_code?: string; comment?: string | null }
): Promise<FlaggedAddressItem | null> {
  if (patch.risk_category_code === undefined && patch.comment === undefined) {
    return null;
  }

  let rowCount = 0;

  if (patch.risk_category_code !== undefined) {
    const categoryResult = await query<{ id: number }>(
      `SELECT id FROM risk_categories WHERE code = $1`,
      [patch.risk_category_code.toLowerCase()]
    );
    if (!categoryResult.rows[0]) {
      throw new Error(`Unknown risk category code: ${patch.risk_category_code}`);
    }
    const risk_category_id = categoryResult.rows[0].id;

    if (patch.comment !== undefined) {
      const result = await query(
        `UPDATE flagged_addresses SET risk_category_id = $1, comment = $2 WHERE id = $3 AND is_active = TRUE`,
        [risk_category_id, patch.comment, id]
      );
      rowCount = result.rowCount ?? 0;
    } else {
      const result = await query(
        `UPDATE flagged_addresses SET risk_category_id = $1 WHERE id = $2 AND is_active = TRUE`,
        [risk_category_id, id]
      );
      rowCount = result.rowCount ?? 0;
    }
  } else {
    const result = await query(
      `UPDATE flagged_addresses SET comment = $1 WHERE id = $2 AND is_active = TRUE`,
      [patch.comment, id]
    );
    rowCount = result.rowCount ?? 0;
  }

  if (rowCount === 0) return null;

  return getFlaggedAddressById(id);
}

export async function deactivateFlaggedAddress(id: string): Promise<boolean> {
  const result = await query(
    `UPDATE flagged_addresses SET is_active = FALSE WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function exportFlaggedAddresses(): Promise<FlaggedAddressItem[]> {
  const result = await query<FlaggedAddressRow>(
    `${FLAGGED_SELECT} WHERE fa.is_active = TRUE ORDER BY fa.created_at DESC`,
    []
  );
  return result.rows.map(rowToFlaggedAddress);
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

export async function importFlaggedAddresses(
  records: ImportRecord[],
  userId: string
): Promise<ImportResult> {
  const { randomUUID } = await import("crypto");

  // Resolve all distinct network codes at once.
  const networkCodes = [...new Set(records.map((r) => r.network_code.toUpperCase()))];
  const networkRows = await query<{ id: number; code: string }>(
    `SELECT id, code FROM networks WHERE code = ANY($1)`,
    [networkCodes]
  );
  const networkMap = new Map(networkRows.rows.map((r) => [r.code, r.id]));

  // Resolve all distinct category codes at once.
  const categoryCodes = [...new Set(records.map((r) => r.risk_category_code.toLowerCase()))];
  const categoryRows = await query<{ id: number; code: string }>(
    `SELECT id, code FROM risk_categories WHERE code = ANY($1)`,
    [categoryCodes]
  );
  const categoryMap = new Map(categoryRows.rows.map((r) => [r.code, r.id]));

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const rec of records) {
    const networkCode = rec.network_code.toUpperCase();
    const categoryCode = rec.risk_category_code.toLowerCase();
    const address = rec.address.trim();

    const network_id = networkMap.get(networkCode);
    if (!network_id) {
      errors.push(`Unknown network code: ${networkCode} (address: ${address})`);
      continue;
    }

    const risk_category_id = categoryMap.get(categoryCode);
    if (!risk_category_id) {
      errors.push(`Unknown risk category code: ${categoryCode} (address: ${address})`);
      continue;
    }

    if (!address) {
      errors.push(`Empty address for network ${networkCode}`);
      continue;
    }

    try {
      const result = await query(
        `INSERT INTO flagged_addresses
           (id, network_id, address, risk_category_id, comment, created_by_user_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (network_id, address) DO NOTHING`,
        [randomUUID(), network_id, address, risk_category_id, rec.comment ?? null, userId]
      );
      if ((result.rowCount ?? 0) > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch {
      errors.push(`Failed to insert address ${address} on network ${networkCode}`);
    }
  }

  return { inserted, skipped, errors };
}

// ─── Risk categories and networks (for UI selects) ────────────────────────────

export interface RiskCategory {
  id: number;
  code: string;
  name: string;
  severity: number;
}

export async function getRiskCategories(): Promise<RiskCategory[]> {
  const result = await query<RiskCategory & QueryResultRow>(
    `SELECT id, code, name, severity FROM risk_categories ORDER BY severity DESC, name`,
    []
  );
  return result.rows;
}

export interface NetworkItem {
  id: number;
  code: string;
  name: string;
  is_active?: boolean;
  default_depth: number;
  max_depth: number;
  default_tx_limit: number;
  max_tx_limit: number;
  default_period_days: number | null;
  max_period_days: number;
}

export async function getNetworks(): Promise<NetworkItem[]> {
  const result = await query<NetworkItem & QueryResultRow>(
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

export interface AdminNetworkItem {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  default_depth: number;
  max_depth: number;
  default_tx_limit: number;
  max_tx_limit: number;
  default_period_days: number | null;
  max_period_days: number;
}

export async function listAllNetworks(): Promise<AdminNetworkItem[]> {
  const result = await query<AdminNetworkItem & QueryResultRow>(
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

export type NetworkLimitsPatch = Partial<Pick<
  AdminNetworkItem,
  | "default_depth"
  | "max_depth"
  | "default_tx_limit"
  | "max_tx_limit"
  | "default_period_days"
  | "max_period_days"
>>;

export type NetworkConfigPatch = NetworkLimitsPatch & {
  is_active?: boolean;
};

const NETWORK_CONFIG_SELECT = `
  SELECT
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
`;

export async function getNetworkAnalysisConfig(
  code: string
): Promise<AdminNetworkItem | null> {
  const result = await query<AdminNetworkItem & QueryResultRow>(
    `${NETWORK_CONFIG_SELECT} WHERE code = $1 LIMIT 1`,
    [code.trim().toUpperCase()]
  );
  return result.rows[0] ?? null;
}

export async function updateNetworkConfig(
  code: string,
  patch: NetworkConfigPatch
): Promise<AdminNetworkItem | null> {
  const fields: Array<keyof NetworkConfigPatch> = [
    "is_active",
    "default_depth",
    "max_depth",
    "default_tx_limit",
    "max_tx_limit",
    "default_period_days",
    "max_period_days",
  ];
  const updates = fields.filter((field) => patch[field] !== undefined);

  if (updates.length === 0) {
    return getNetworkAnalysisConfig(code);
  }

  const values: unknown[] = updates.map((field) => patch[field]);
  values.push(code.trim().toUpperCase());

  const setClause = updates
    .map((field, index) => `${field} = $${index + 1}`)
    .join(", ");

  const result = await query<AdminNetworkItem & QueryResultRow>(
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

export async function updateNetworkLimits(
  code: string,
  patch: NetworkLimitsPatch
): Promise<AdminNetworkItem | null> {
  return updateNetworkConfig(code, patch);
}

export async function setNetworkActive(
  code: string,
  isActive: boolean
): Promise<boolean> {
  const updated = await updateNetworkConfig(code, { is_active: isActive });
  return updated !== null;
}

export async function isNetworkActive(code: string): Promise<boolean> {
  const result = await query<{ is_active: boolean } & QueryResultRow>(
    `SELECT is_active FROM networks WHERE code = $1 LIMIT 1`,
    [code.trim().toUpperCase()]
  );
  return result.rows[0]?.is_active === true;
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

// ─── Admin user management ────────────────────────────────────────────────────

export interface UserListItem {
  id: string;
  email: string;
  role: Role;
  isBlocked: boolean;
  createdAt: string;
  hasPassword: boolean;
  hasOAuth: boolean;
}

export interface UserDetailItem extends UserListItem {
  oauthProviders: string[];
}

export interface UserListFilters {
  email?: string;
  role?: Role;
  isBlocked?: boolean;
}

interface AdminUserRow extends QueryResultRow {
  id: string;
  email: string;
  is_blocked: boolean;
  created_at: Date;
  roles: string[] | null;
  has_password: boolean;
  oauth_providers: string[] | null;
}

function rowToUserListItem(row: AdminUserRow): UserListItem {
  return {
    id: row.id,
    email: row.email,
    role: (strongestRole(row.roles ?? []) ?? "user") as Role,
    isBlocked: row.is_blocked,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
    hasPassword: row.has_password,
    hasOAuth: (row.oauth_providers ?? []).length > 0,
  };
}

function rowToUserDetailItem(row: AdminUserRow): UserDetailItem {
  return {
    ...rowToUserListItem(row),
    oauthProviders: row.oauth_providers ?? [],
  };
}

const ADMIN_USER_SELECT = `
  SELECT
    u.id,
    u.email,
    u.is_blocked,
    u.created_at,
    COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
    u.password_hash IS NOT NULL AS has_password,
    COALESCE(array_agg(DISTINCT oa.provider) FILTER (WHERE oa.provider IS NOT NULL), '{}') AS oauth_providers
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
  LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
`;

export async function listUsers(
  filters: UserListFilters,
  limit: number,
  offset: number
): Promise<{ items: UserListItem[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.email) {
    params.push(`%${filters.email}%`);
    conditions.push(`u.email ILIKE $${params.length}`);
  }
  if (filters.isBlocked !== undefined) {
    params.push(filters.isBlocked);
    conditions.push(`u.is_blocked = $${params.length}`);
  }

  // Role filter requires a HAVING clause since roles come from aggregation.
  const having = filters.role
    ? `HAVING array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) @> ARRAY[$${params.length + 1}::text]`
    : "";
  if (filters.role) params.push(filters.role);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const listParams = [...params, limit, offset];
  const countParams = [...params];

  const [listResult, countResult] = await Promise.all([
    query<AdminUserRow>(
      `${ADMIN_USER_SELECT}
       ${where}
       GROUP BY u.id, u.email, u.is_blocked, u.created_at, u.password_hash
       ${having}
       ORDER BY u.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    ),
    query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM (
         ${ADMIN_USER_SELECT}
         ${where}
         GROUP BY u.id, u.email, u.is_blocked, u.created_at, u.password_hash
         ${having}
       ) AS sub`,
      countParams
    ),
  ]);

  return {
    items: listResult.rows.map(rowToUserListItem),
    total: parseInt(countResult.rows[0]?.total ?? "0", 10),
  };
}

export async function getUserById(id: string): Promise<UserDetailItem | null> {
  const result = await query<AdminUserRow>(
    `${ADMIN_USER_SELECT}
     WHERE u.id = $1
     GROUP BY u.id, u.email, u.is_blocked, u.created_at, u.password_hash`,
    [id]
  );
  const row = result.rows[0];
  return row ? rowToUserDetailItem(row) : null;
}

export async function adminCreateUser(
  email: string,
  passwordHash: string,
  role: Role
): Promise<{ id: string; email: string }> {
  const { randomUUID } = await import("crypto");
  const id = randomUUID();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [role]
    );

    await client.query(
      `INSERT INTO users (id, email, password_hash, is_blocked) VALUES ($1, $2, $3, FALSE)`,
      [id, email, passwordHash]
    );

    await client.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2`,
      [id, role]
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

export async function setUserRole(userId: string, role: Role): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [role]
    );

    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);

    const result = await client.query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2`,
      [userId, role]
    );

    await client.query("COMMIT");
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setUserBlocked(userId: string, isBlocked: boolean): Promise<boolean> {
  const result = await query(
    `UPDATE users SET is_blocked = $1 WHERE id = $2`,
    [isBlocked, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteUser(userId: string): Promise<boolean> {
  const result = await query(`DELETE FROM users WHERE id = $1`, [userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function countAdminUsers(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'admin'`,
    []
  );
  return parseInt(result.rows[0]?.count ?? "0", 10);
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export interface AuditLogItem {
  id: string;
  user_id: string | null;
  user_email: string | null;
  actor_role: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details_json: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogFilters {
  action?: string;
  userId?: string;
  email?: string;
  role?: string;
  entity?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface AuditLogRow extends QueryResultRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  actor_role: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details_json: Record<string, unknown> | null;
  created_at: Date;
}

export async function logAuditEvent(event: {
  userId: string | null;
  action: string;
  actorRole?: "user" | "moderator" | "admin" | null;
  entity?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const { randomUUID } = await import("crypto");
    await query(
      `INSERT INTO audit_logs (id, user_id, actor_role, action, entity, entity_id, details_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        event.userId,
        event.actorRole ?? null,
        event.action,
        event.entity ?? null,
        event.entityId ?? null,
        event.details ? JSON.stringify(event.details) : null,
      ]
    );
  } catch (err) {
    console.error("[audit] Failed to write audit event:", err);
  }
}

export async function getAuditLogs(
  filters: AuditLogFilters,
  limit: number,
  offset: number
): Promise<{ items: AuditLogItem[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.action) {
    params.push(filters.action);
    conditions.push(`al.action = $${params.length}`);
  }
  if (filters.userId) {
    params.push(filters.userId);
    conditions.push(`al.user_id = $${params.length}`);
  }
  if (filters.email) {
    params.push(`%${filters.email}%`);
    conditions.push(`u.email ILIKE $${params.length}`);
  }
  if (filters.role) {
    params.push(filters.role);
    conditions.push(`al.actor_role = $${params.length}`);
  }
  if (filters.entity) {
    params.push(filters.entity);
    conditions.push(`al.entity = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`al.created_at >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`al.created_at < $${params.length}`);
  }

  // email filter requires the users join in both list and count queries.
  const needsUserJoin = Boolean(filters.email);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const listParams = [...params, limit, offset];
  const countParams = [...params];

  const [listResult, countResult] = await Promise.all([
    query<AuditLogRow>(
      `SELECT
         al.id,
         al.user_id,
         u.email   AS user_email,
         al.actor_role,
         al.action,
         al.entity,
         al.entity_id,
         al.details_json,
         al.created_at
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    ),
    query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM audit_logs al
       ${needsUserJoin ? "LEFT JOIN users u ON u.id = al.user_id" : ""}
       ${where}`,
      countParams
    ),
  ]);

  return {
    items: listResult.rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      user_email: row.user_email,
      actor_role: row.actor_role,
      action: row.action,
      entity: row.entity,
      entity_id: row.entity_id,
      details_json: row.details_json ?? null,
      created_at: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    })),
    total: parseInt(countResult.rows[0]?.total ?? "0", 10),
  };
}
