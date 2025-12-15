// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, setSessionCookie } from '@/lib/auth';
import { getUserByEmail, createSession } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const emailRaw = body.email;
    const password: string = body.password;

    if (
      typeof emailRaw !== 'string' ||
      typeof password !== 'string' ||
      emailRaw.trim().length < 3 ||
      password.length < 6
    ) {
      return NextResponse.json(
        { message: 'Invalid email or password' },
        { status: 400 },
      );
    }

    const email = emailRaw.trim().toLowerCase();
    const user = await getUserByEmail(email);

    if (!user || !user.password_hash) {
      return NextResponse.json(
        { message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return NextResponse.json(
        { message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    const { id: sessionId, expiresAt } = await createSession(user.id);

    const res = NextResponse.json({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    setSessionCookie(res, sessionId, expiresAt);
    return res;
  } catch (err) {
    console.error('Login error', err);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  }
}
