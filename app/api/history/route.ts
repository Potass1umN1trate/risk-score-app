// app/api/history/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/pages/api/auth/[...nextauth]';
import { getUserHistory } from '@/lib/db';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = String((session?.user as any)?.id || '');

    if (!session || !userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const rows = await getUserHistory({ userId, limit: 20 });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        blockchain: row.blockchain,
        rootAddress: row.rootAddress,
        depth: row.depth,
        globalRiskScore: row.globalRiskScore,
      })),
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in /api/history', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
