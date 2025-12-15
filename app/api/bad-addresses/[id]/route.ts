// app/api/bad-addresses/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { pg } from '@/lib/db';
import { getSessionUser } from '@/lib/auth-session';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 },
      );
    }

    // params теперь Promise – берём id вот так
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    if (!Number.isFinite(id)) {
      return NextResponse.json(
        { message: 'Invalid id' },
        { status: 400 },
      );
    }

    let result;
    if (user.role === 'admin') {
      result = await pg.query('DELETE FROM bad_addresses WHERE id = $1', [
        id,
      ]);
    } else if (user.role === 'pusher') {
      result = await pg.query(
        'DELETE FROM bad_addresses WHERE id = $1 AND user_id = $2',
        [id, String(user.userId)],
      );
    } else {
      return NextResponse.json(
        { message: 'Forbidden' },
        { status: 403 },
      );
    }

    if (result.rowCount === 0) {
      return NextResponse.json(
        { message: 'Not found or not allowed' },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error in DELETE /api/bad-addresses/[id]', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
