// lib/auth.ts
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import type { AuthSession } from './types';
import { createSession, getSessionAndUser, deleteSession } from './db';

export const SESSION_COOKIE_NAME = 'session';

export async function hashPassword(plain: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(plain, saltRounds);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export function setSessionCookie(
  res: NextResponse,
  sessionId: string,
  expiresAt: Date,
) {
  res.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(0),
  });
}

// для API-роутов
export async function getCurrentUserFromRequest(
  req: NextRequest,
): Promise<AuthSession | null> {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;
  return getSessionAndUser(sessionId);
}

// на будущее: logout по sessionId (если понадобится из других мест)
export async function logoutBySessionId(sessionId: string) {
  await deleteSession(sessionId);
}

export async function getSessionUser(
  req: Request,
): Promise<AuthSession | null> {
  // В API-роутах тип `req` — Web Request, у него нет req.cookies,
  // поэтому парсим куки руками из заголовка
  const cookieHeader = req.headers.get('cookie') || '';

  let sessionId: string | undefined;

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const name = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);

    if (name === SESSION_COOKIE_NAME) {
      sessionId = decodeURIComponent(value);
      break;
    }
  }

  if (!sessionId) return null;

  // getSessionAndUser уже возвращает AuthSession ({ userId, email, role })
  return getSessionAndUser(sessionId);
}