// app/api/admin/users/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { pg } from '@/lib/db';
import { getCurrentUserFromRequest } from '@/lib/auth';
import type { UserRole } from '@/lib/types';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const current = await getCurrentUserFromRequest(req);

    // только админ имеет право менять роли
    if (!current || current.role !== 'admin') {
      return NextResponse.json(
        { message: 'Forbidden' },
        { status: 403 },
      );
    }

    // params теперь Promise — вытаскиваем id так
    const { id: idStr } = await context.params;
    const userId = Number(idStr);

    if (!Number.isFinite(userId)) {
      return NextResponse.json(
        { message: 'Invalid user id' },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const role = body.role as UserRole | undefined;

    if (!role || !['user', 'pusher', 'admin'].includes(role)) {
      return NextResponse.json(
        { message: 'Invalid role' },
        { status: 400 },
      );
    }

    const result = await pg.query(
      `
        UPDATE users
        SET role = $1
        WHERE id = $2
        RETURNING id, email, role, created_at
      `,
      [role, userId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 },
      );
    }

    const row = result.rows[0];

    return NextResponse.json(
      {
        id: row.id,
        email: row.email,
        role: row.role,
        createdAt: row.created_at,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('PATCH /api/admin/users/[id] error', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
