// app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth';
import { deleteSession } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (sessionId) {
      await deleteSession(sessionId);
    }

    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  } catch (err) {
    console.error('Logout error', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
