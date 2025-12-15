import { NextRequest, NextResponse } from 'next/server';
import { pg } from '@/lib/db';
import { getSessionUser } from '@/lib/auth-session';
import type { SupportedBlockchain } from '@/lib/types';
import { isValidAddressFormat } from '@/lib/blockchainValidators';

export const runtime = 'nodejs';

// простой CSV-парсер одной строки (учитывает кавычки и экранированные кавычки)
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((v) => v.trim());
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || (user.role !== 'pusher' && user.role !== 'admin')) {
      return NextResponse.json(
        { message: 'Forbidden' },
        { status: 403 },
      );
    }

    const csvText = await req.text();
    if (!csvText.trim()) {
      return NextResponse.json(
        { message: 'Empty CSV' },
        { status: 400 },
      );
    }

    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      return NextResponse.json(
        { message: 'CSV must contain header and at least one row' },
        { status: 400 },
      );
    }

    const headerCols = splitCsvLine(lines[0]).map((h) =>
      h.toLowerCase(),
    );

    const idx = (name: string) => headerCols.indexOf(name);

    const idxBlockchain = idx('blockchain');
    const idxAddress = idx('address');
    const idxTag = idx('tag');
    const idxRisk = idx('risk_level');
    const idxSource = idx('source');
    const idxEvidence = idx('evidence_url');

    if (idxBlockchain === -1 || idxAddress === -1) {
      return NextResponse.json(
        {
          message:
            'Header must contain at least "blockchain" and "address" columns',
        },
        { status: 400 },
      );
    }

    const client = await pg.connect();

    let imported = 0;
    let skippedInvalid = 0;
    const errors: string[] = [];

    try {
      await client.query('BEGIN');

      for (let lineNo = 1; lineNo < lines.length; lineNo++) {
        const line = lines[lineNo];
        if (!line) continue;

        const cols = splitCsvLine(line);
        const getCol = (idx: number) =>
          idx >= 0 && idx < cols.length ? cols[idx] : '';

        const blockchainRaw = getCol(idxBlockchain).toLowerCase();
        const addressRaw = getCol(idxAddress);
        const tag = getCol(idxTag);
        const riskRaw = getCol(idxRisk);
        const source = getCol(idxSource);
        const evidenceUrl = getCol(idxEvidence);

        if (
          blockchainRaw !== 'bitcoin' &&
          blockchainRaw !== 'ethereum'
        ) {
          skippedInvalid++;
          errors.push(
            `Line ${lineNo + 1}: unsupported blockchain "${blockchainRaw}"`,
          );
          continue;
        }

        const blockchain = blockchainRaw as SupportedBlockchain;
        const address = addressRaw.trim();

        if (!isValidAddressFormat(blockchain, address)) {
          skippedInvalid++;
          errors.push(
            `Line ${lineNo + 1}: invalid address format "${address}" for ${blockchain}`,
          );
          continue;
        }

        let riskLevel = 100;
        if (riskRaw) {
          const parsed = Number(riskRaw);
          if (Number.isFinite(parsed)) {
            riskLevel = Math.max(
              0,
              Math.min(100, Math.round(parsed)),
            );
          }
        }

        await client.query(
          `INSERT INTO bad_addresses
             (blockchain, address, tag, risk_level, source, evidence_url, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (blockchain, address) DO UPDATE
             SET tag = EXCLUDED.tag,
                 risk_level = EXCLUDED.risk_level,
                 source = EXCLUDED.source,
                 evidence_url = EXCLUDED.evidence_url,
                 updated_at = NOW()`,
          [
            blockchain,
            address,
            tag || null,
            riskLevel,
            source || null,
            evidenceUrl || null,
            user.userId,
          ],
        );

        imported++;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json(
      {
        imported,
        skippedInvalid,
        errors,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in POST /api/bad-addresses/import', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
