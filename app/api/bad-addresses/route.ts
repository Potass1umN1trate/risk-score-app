// app/api/bad-addresses/route.ts
import { NextResponse } from 'next/server';
import { pg } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 },
      );
    }

    const url = new URL(req.url);
    const format = url.searchParams.get('format');

    const res = await pg.query(
      `SELECT id, blockchain, address, tag, risk_level, source,
              evidence_url, user_id, first_seen_at, last_seen_at,
              created_at, updated_at
       FROM bad_addresses
       ORDER BY created_at DESC
       LIMIT 1000`,
    );

    const rows = res.rows;

    if (format === 'csv') {
      const header =
        'id,blockchain,address,tag,risk_level,source,evidence_url,user_id,first_seen_at,last_seen_at,created_at,updated_at';
      const lines = rows.map((r) =>
        [
          r.id,
          r.blockchain,
          r.address,
          r.tag ?? '',
          r.risk_level,
          r.source ?? '',
          r.evidence_url ?? '',
          r.user_id ?? '',
          r.first_seen_at ?? '',
          r.last_seen_at ?? '',
          r.created_at ?? '',
          r.updated_at ?? '',
        ]
          .map((v) => String(v).replace(/"/g, '""'))
          .map((v) => `"${v}"`)
          .join(','),
      );

      const csv = [header, ...lines].join('\n');

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="bad_addresses.csv"',
        },
      });
    }

    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error('Error in GET /api/bad-addresses', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user || (user.role !== 'pusher' && user.role !== 'admin')) {
        return NextResponse.json(
            { message: 'Forbidden' },
            { status: 403 },
        );
    }

    const body = await req.json();
    const {
      blockchain,
      address,
      tag,
      riskLevel,
      source,
      evidenceUrl,
    } = body;

    const res = await pg.query(
      `INSERT INTO bad_addresses
       (blockchain, address, tag, risk_level, source, evidence_url, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (blockchain, address) DO UPDATE
         SET tag = EXCLUDED.tag,
             risk_level = EXCLUDED.risk_level,
             source = EXCLUDED.source,
             evidence_url = EXCLUDED.evidence_url,
             updated_at = NOW()
       RETURNING *`,
      [
        blockchain,
        address,
        tag ?? null,
        riskLevel,
        source ?? null,
        evidenceUrl ?? null,
        String(user.userId),
      ],
    );

    return NextResponse.json(res.rows[0], { status: 201 });
  } catch (err) {
    console.error('Error in POST /api/bad-addresses', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
