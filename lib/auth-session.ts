// lib/auth-session.ts
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/pages/api/auth/[...nextauth]';
import type { AuthSession, UserRole } from './types';

export async function getSessionUser(): Promise<AuthSession | null> {
  const session = await getServerSession(authOptions);

  if (!session?.user || !(session.user as any).id) return null;

  return {
    userId: Number((session.user as any).id),
    email: session.user.email || '',
    role: ((session.user as any).role || 'user') as UserRole,
  };
}
