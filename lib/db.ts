// lib/db.ts
import crypto from 'crypto';
import { Pool } from 'pg';
import type { UserRole, AuthSession, SupportedBlockchain, WalletAnalysisResult } from './types';

const connectionConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST ?? process.env.POSTGRES_HOST ?? 'db',
      port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
      user: process.env.PGUSER ?? process.env.POSTGRES_USER,
      password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD,
      database: process.env.PGDATABASE ?? process.env.POSTGRES_DB,
    };

export const pg = new Pool({
  ...connectionConfig,
  max: 5,
});

export interface DbUser {
  id: number;
  email: string;
  password_hash: string | null;
  github_id: string | null;
  metamask_address: string | null;
  role: UserRole;
  created_at: Date;
}

// Output format from getUserHistory (camelCase)
export interface HistoryRow {
  id: number;
  userId: string | null;
  blockchain: SupportedBlockchain;
  rootAddress: string;
  depth: number;
  globalRiskScore: number;
  createdAt: Date;
}

/**
 * IMPORTANT:
 * Database risk_score column is INTEGER. Any decimal values must be converted to int.
 * Otherwise: "invalid input syntax for type integer: 8.65"
 */
function scoreToInt(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(0, Math.min(100, n));
  return Math.round(clamped);
}

export async function saveAnalysis(
  userId: string | null,
  analysis: WalletAnalysisResult,
): Promise<void> {
  const client = await pg.connect();
  try {
    await client.query(
      `
        INSERT INTO analysis_history (
          user_id,
          blockchain,
          root_address,
          depth,
          global_risk_score,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
      `,
      [
        userId,
        analysis.blockchain,
        analysis.rootAddress,
        analysis.depth,
        scoreToInt(analysis.globalRiskScore), // Convert to integer for database
      ],
    );
  } finally {
    client.release();
  }
}

interface GetUserHistoryParams {
  userId: string | null;
  limit?: number;
}

export async function getUserHistory(
  params: GetUserHistoryParams,
): Promise<HistoryRow[]> {
  const { userId, limit = 20 } = params;
  const client = await pg.connect();

  try {
    const withUser = `
      SELECT
        id,
        user_id,
        blockchain,
        root_address,
        depth,
        global_risk_score,
        created_at
      FROM analysis_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const withoutUser = `
      SELECT
        id,
        user_id,
        blockchain,
        root_address,
        depth,
        global_risk_score,
        created_at
      FROM analysis_history
      ORDER BY created_at DESC
      LIMIT $1
    `;

    const { rows } = userId
      ? await client.query(withUser, [userId, limit])
      : await client.query(withoutUser, [limit]);

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id ?? null,
      blockchain: row.blockchain,
      rootAddress: row.root_address,
      depth: row.depth,
      globalRiskScore: Number(row.global_risk_score), // int -> number
      createdAt: row.created_at,
    }));
  } finally {
    client.release();
  }
}

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const res = await pg.query<DbUser>(
    `
    SELECT id,
           email,
           password_hash,
           github_id,
           metamask_address,
           role,
           created_at
    FROM users
    WHERE email = $1
    `,
    [email.toLowerCase()],
  );

  return res.rows[0] ?? null;
}

export async function createUserWithEmail(
  email: string,
  passwordHash: string,
): Promise<DbUser> {
  const res = await pg.query<DbUser>(
    `
    INSERT INTO users (email, password_hash)
    VALUES ($1, $2)
    RETURNING id,
              email,
              password_hash,
              github_id,
              metamask_address,
              role,
              created_at
    `,
    [email.toLowerCase(), passwordHash],
  );

  return res.rows[0];
}

export async function updateUserRole(
  userId: number,
  role: UserRole,
): Promise<void> {
  await pg.query(
    `
    UPDATE users
    SET role = $2
    WHERE id = $1
    `,
    [userId, role],
  );
}

export async function createSession(
  userId: number,
  ttlHours = 24 * 7,
): Promise<{ id: string; expiresAt: Date }> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

  await pg.query(
    `
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES ($1, $2, $3)
    `,
    [id, userId, expiresAt.toISOString()],
  );

  return { id, expiresAt };
}

export async function getSessionAndUser(
  sessionId: string,
): Promise<AuthSession | null> {
  const res = await pg.query(
    `
    SELECT s.user_id, u.email, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = $1
      AND s.expires_at > NOW()
    `,
    [sessionId],
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
  };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await pg.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

/**
 * Автофлаг: bad_addresses.risk_level тоже обычно INTEGER -> округляем.
 */
export async function autoFlagBadAddress(params: {
  blockchain: SupportedBlockchain;
  address: string;
  riskLevel: number;
}): Promise<void> {
  const riskLevel = scoreToInt(params.riskLevel);

  await pg.query(
    `
    INSERT INTO bad_addresses (
      blockchain,
      address,
      tag,
      risk_level,
      source,
      evidence_url,
      user_id,
      first_seen_at,
      last_seen_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NULL, NOW(), NOW())
    ON CONFLICT (blockchain, address) DO UPDATE
      SET risk_level = GREATEST(bad_addresses.risk_level, EXCLUDED.risk_level),
          last_seen_at = EXCLUDED.last_seen_at,
          source = EXCLUDED.source
    `,
    [
      params.blockchain,
      params.address,
      'auto-suspicious',
      riskLevel,
      'auto: risk-score propagation',
      null,
    ],
  );
}

/**
 * Ты это используешь из analysis.ts: upsertScannedAddressRisk(...)
 * Делаем нормальный upsert и опять же пишем int.
 *
 * ВАЖНО: если у тебя нет UNIQUE(blockchain, address) на bad_addresses — добавь,
 * иначе ON CONFLICT не сработает.
 */
export async function upsertScannedAddressRisk(params: {
  blockchain: SupportedBlockchain;
  address: string;
  riskLevel: number;
}): Promise<void> {
  const riskLevel = scoreToInt(params.riskLevel);

  await pg.query(
    `
    INSERT INTO bad_addresses (
      blockchain,
      address,
      tag,
      risk_level,
      source,
      evidence_url,
      user_id,
      first_seen_at,
      last_seen_at
    )
    VALUES ($1, $2, NULL, $3, $4, NULL, NULL, NOW(), NOW())
    ON CONFLICT (blockchain, address) DO UPDATE
      SET risk_level = GREATEST(bad_addresses.risk_level, EXCLUDED.risk_level),
          last_seen_at = EXCLUDED.last_seen_at,
          source = EXCLUDED.source
    `,
    [
      params.blockchain,
      params.address,
      riskLevel,
      'auto: scanned-root',
    ],
  );
}

export async function getDbClient() {
  return pg.connect();
}
