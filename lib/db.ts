// lib/db.ts
import { Pool } from 'pg';
import type { SupportedBlockchain, WalletAnalysisResult } from './types';

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

// То, что возвращает getUserHistory наружу (camelCase)
export interface HistoryRow {
  id: number;
  userId: string | null;
  blockchain: SupportedBlockchain;
  rootAddress: string;
  depth: number;
  globalRiskScore: number;
  createdAt: Date;
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
        analysis.globalRiskScore,
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

    // Мапим snake_case → camelCase ОДИН раз здесь
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id ?? null,
      blockchain: row.blockchain,
      rootAddress: row.root_address,
      depth: row.depth,
      globalRiskScore: Number(row.global_risk_score),
      createdAt: row.created_at,
    }));
  } finally {
    client.release();
  }
}
