// app/api/history/route.ts
import { NextResponse } from 'next/server';
import { getUserHistory } from '@/lib/db';

export async function GET() {
  try {
    // Пока без авторизации — userId = null, берем последние записи
    const rows = await getUserHistory({ userId: null, limit: 20 });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,          // ✅ camelCase
        blockchain: row.blockchain,
        rootAddress: row.rootAddress,      // ✅ camelCase
        depth: row.depth,
        globalRiskScore: row.globalRiskScore, // ✅ camelCase
      })),
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in /api/history', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
