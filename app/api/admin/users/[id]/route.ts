import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/pages/api/auth/[...nextauth]';
import { getDbClient } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

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

  // ✅ защита от самоудаления (иначе можно убить админку одним кликом)
  if (Number.isFinite(sessionUserId) && sessionUserId === userId) {
    return NextResponse.json(
      { message: 'You cannot delete your own account' },
      { status: 400 },
    );
  }

  const client = await getDbClient();

  try {
    await client.query('BEGIN');

    // если у тебя FK на history -> users, то сначала чистим зависимые таблицы
    await client.query('DELETE FROM analysis_history WHERE user_id = $1', [userId]);

    // bad_addresses: отвязываем (ты так и делал — ок)
    await client.query('UPDATE bad_addresses SET user_id = NULL WHERE user_id = $1', [userId]);

    const delRes = await client.query('DELETE FROM users WHERE id = $1', [userId]);

    if ((delRes.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
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
