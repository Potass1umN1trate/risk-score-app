const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const { loadEnvConfig } = require("@next/env");
const { Pool } = require("pg");

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!adminEmail || !adminPassword) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function main() {
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const userId = randomUUID();

  await pool.query("BEGIN");

  await pool.query(
    "INSERT INTO roles (name) VALUES ('admin') ON CONFLICT (name) DO NOTHING"
  );

  const existingUser = (await pool.query(
    "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
    [adminEmail]
  )) as { rows: { id: string }[] };

  const effectiveUserId = existingUser.rows[0]?.id ?? userId;

  if (existingUser.rows[0]) {
    await pool.query(
      `
        UPDATE users
        SET email = $1, password_hash = $2, is_blocked = FALSE
        WHERE id = $3
      `,
      [adminEmail, passwordHash, effectiveUserId]
    );
  } else {
    await pool.query(
      `
        INSERT INTO users (id, email, password_hash, is_blocked)
        VALUES ($1, $2, $3, FALSE)
      `,
      [effectiveUserId, adminEmail, passwordHash]
    );
  }

  await pool.query(
    `
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1, id FROM roles WHERE name = 'admin'
      ON CONFLICT DO NOTHING
    `,
    [effectiveUserId]
  );

  await pool.query("COMMIT");
  console.log(`Admin user is ready: ${adminEmail}`);
}

main()
  .catch(async (error: unknown) => {
    await pool.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to seed admin user: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
