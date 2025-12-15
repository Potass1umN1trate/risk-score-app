// app/api/admin/users/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/pages/api/auth/[...nextauth]';
import { getDbClient, updateUserRole } from '@/lib/db';
import type { UserRole } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

function isUserRole(x: any): x is UserRole {
  return x === 'user' || x === 'pusher' || x === 'admin';
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;

  if (!session || role !== 'admin') {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);

  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ message: 'Invalid user id' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const newRole = body?.role;

  if (!isUserRole(newRole)) {
    return NextResponse.json({ message: 'Invalid role' }, { status: 400 });
  }

  // Обновляем роль
  await updateUserRole(userId, newRole);

  // Возвращаем обновлённого юзера (фронт ждёт это)
  const client = await getDbClient();
  try {
    const res = await client.query(
      `
      SELECT id, email, role, created_at
      FROM users
      WHERE id = $1
      `,
      [userId],
    );

    const u = res.rows[0];
    if (!u) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: u.id,
        email: u.email,
        role: u.role,
        createdAt: u.created_at,
      },
      { status: 200 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions);

  const role = (session?.user as any)?.role;
  const sessionUserId = Number((session?.user as any)?.id);

  if (!session || role !== 'admin') {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);

  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ message: 'Invalid user id' }, { status: 400 });
  }

  // защита от самоудаления
  if (Number.isFinite(sessionUserId) && sessionUserId === userId) {
    return NextResponse.json(
      { message: 'You cannot delete your own account' },
      { status: 400 },
    );
  }

  const client = await getDbClient();

  try {
    await client.query('BEGIN');

    // NB: user_id может быть text/varchar (у тебя уже есть demo-user-id),
    // поэтому приводим к строке
    await client.query('DELETE FROM analysis_history WHERE user_id = $1', [
      String(userId),
    ]);

    await client.query('UPDATE bad_addresses SET user_id = NULL WHERE user_id = $1', [
      String(userId),
    ]);

    const delRes = await client.query('DELETE FROM users WHERE id = $1', [userId]);

    if ((delRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('Error deleting user', e);
    return NextResponse.json({ message: 'Failed to delete user' }, { status: 500 });
  } finally {
    client.release();
  }
}
