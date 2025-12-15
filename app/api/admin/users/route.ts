import { NextRequest, NextResponse } from 'next/server';
import { pg } from '@/lib/db';
import { getCurrentUserFromRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const me = await getCurrentUserFromRequest(req);
    if (!me || me.role !== 'admin') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const res = await pg.query(
      `SELECT id, email, role, created_at
       FROM users
       ORDER BY created_at DESC`,
    );

    const rows = res.rows.map((r) => ({
      id: r.id as number,
      email: r.email as string,
      role: r.role as 'user' | 'pusher' | 'admin',
      createdAt: r.created_at as string,
    }));

    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error('GET /api/admin/users error', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
