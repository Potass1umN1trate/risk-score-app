// lib/users-nextauth.ts
import { pg } from './db';
import type { UserRole } from './types';

export interface DbUser {
  id: number;
  email: string;
  password_hash: string | null;
  github_id: string | null;
  metamask_address: string | null;
  role: UserRole;
  created_at: Date;
}

export async function findUserByGithubId(
  githubId: string,
): Promise<DbUser | null> {
  const res = await pg.query(
    'SELECT * FROM users WHERE github_id = $1',
    [githubId],
  );
  return (res.rows[0] as DbUser) || null;
}

export async function linkGithubToUser(
  userId: number,
  githubId: string,
): Promise<void> {
  await pg.query(
    'UPDATE users SET github_id = $1 WHERE id = $2',
    [githubId, userId],
  );
}

export async function findUserByMetamaskAddress(
  addr: string,
): Promise<DbUser | null> {
  const res = await pg.query(
    'SELECT * FROM users WHERE LOWER(metamask_address) = LOWER($1)',
    [addr],
  );
  return (res.rows[0] as DbUser) || null;
}

export async function createUserWithMetamaskAddress(
  addr: string,
): Promise<DbUser> {
  const res = await pg.query(
    `INSERT INTO users (email, metamask_address)
     VALUES ($1, $2)
     RETURNING *`,
    [`${addr.toLowerCase()}@metamask.local`, addr.toLowerCase()],
  );
  return res.rows[0] as DbUser;
}
