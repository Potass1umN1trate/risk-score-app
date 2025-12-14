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
