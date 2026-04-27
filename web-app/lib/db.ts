import "server-only";

import { Pool, type QueryResultRow } from "pg";
import { strongestRole, type Role } from "@/lib/rbac";

let pool: Pool | null = null;

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  return databaseUrl;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl() });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
) {
  return getPool().query<T>(text, values);
}

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  isBlocked: boolean;
  role: Role;
}

interface UserRoleRow extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string | null;
  is_blocked: boolean;
  roles: string[] | null;
}

function rowToAuthUser(row: UserRoleRow): AuthUserRecord | null {
  const role = strongestRole(row.roles ?? []);
  if (!role) return null;

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    isBlocked: row.is_blocked,
    role,
  };
}

export async function findUserByEmail(
  email: string
): Promise<AuthUserRecord | null> {
  const result = await query<UserRoleRow>(
    `
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.is_blocked,
        COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE lower(u.email) = lower($1)
      GROUP BY u.id, u.email, u.password_hash, u.is_blocked
      LIMIT 1
    `,
    [email]
  );

  const row = result.rows[0];
  return row ? rowToAuthUser(row) : null;
}

export async function findUserById(id: string): Promise<AuthUserRecord | null> {
  const result = await query<UserRoleRow>(
    `
      SELECT
        u.id,
        u.email,
        u.password_hash,
        u.is_blocked,
        COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = $1
      GROUP BY u.id, u.email, u.password_hash, u.is_blocked
      LIMIT 1
    `,
    [id]
  );

  const row = result.rows[0];
  return row ? rowToAuthUser(row) : null;
}
