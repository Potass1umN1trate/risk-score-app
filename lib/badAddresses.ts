// lib/badAddresses.ts
import { pg } from './db';
import type { SupportedBlockchain } from './types';

export interface BadAddressRecord {
  id: number;
  blockchain: SupportedBlockchain;
  address: string;
  tag: string | null;
  riskLevel: number;
  source: string | null;
  evidenceUrl: string | null;
}

/**
 * Забираем все плохие адреса для набора адресов (по одной сети).
 */
export async function findBadAddressesForAddresses(
  blockchain: SupportedBlockchain,
  addresses: string[],
): Promise<Map<string, BadAddressRecord>> {
  if (!addresses.length) return new Map();

  const res = await pg.query(
    `
      SELECT
        id,
        blockchain,
        address,
        tag,
        risk_level,
        source,
        evidence_url
      FROM bad_addresses
      WHERE blockchain = $1
        AND address = ANY($2::text[])
    `,
    [blockchain, addresses],
  );

  const map = new Map<string, BadAddressRecord>();
  for (const row of res.rows) {
    map.set(row.address, {
      id: row.id,
      blockchain: row.blockchain,
      address: row.address,
      tag: row.tag,
      riskLevel: row.risk_level,
      source: row.source,
      evidenceUrl: row.evidence_url,
    });
  }

  return map;
}

// >>> НОВОЕ: обновление risk_level для уже существующей записи
export async function updateBadAddressRisk(
  blockchain: SupportedBlockchain,
  address: string,
  newRiskLevel: number,
): Promise<void> {
  const risk = Math.max(0, Math.min(100, Math.round(newRiskLevel)));

  await pg.query(
    `
      UPDATE bad_addresses
      SET risk_level = $3,
          last_seen_at = COALESCE(last_seen_at, NOW()),
          updated_at = NOW()
      WHERE blockchain = $1 AND address = $2
    `,
    [blockchain, address, risk],
  );
}

export async function updateRiskIfHigher(
  blockchain: SupportedBlockchain,
  address: string,
  newRiskLevel: number,
): Promise<void> {
  const risk = Math.max(0, Math.min(100, Math.round(newRiskLevel)));

  await pg.query(
    `
      UPDATE bad_addresses
      SET risk_level = GREATEST(risk_level, $3::smallint),
          updated_at = NOW()
      WHERE blockchain = $1 AND address = $2
    `,
    [blockchain, address, risk],
  );
}