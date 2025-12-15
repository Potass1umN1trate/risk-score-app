// lib/users.ts
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

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const res = await pg.query(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase()],
  );
  return (res.rows[0] as DbUser) || null;
}

export async function createUserWithEmailPassword(
  email: string,
  passwordHash: string,
): Promise<DbUser> {
  const res = await pg.query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2)
     RETURNING *`,
    [email.toLowerCase(), passwordHash],
  );
  return res.rows[0] as DbUser;
}

/** Повышение/понижение роли – будем дергать из админских эндпоинтов */
export async function updateUserRole(
  userId: number,
  role: UserRole,
): Promise<void> {
  await pg.query(
    'UPDATE users SET role = $1 WHERE id = $2',
    [role, userId],
  );
}
