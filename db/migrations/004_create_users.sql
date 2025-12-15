-- 1) Роли и пользователи
CREATE TABLE IF NOT EXISTS users (
    id                BIGSERIAL PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    password_hash     TEXT,         -- для email+password
    github_id         TEXT UNIQUE,  -- для GitHub OAuth в будущем
    metamask_address  TEXT UNIQUE,  -- для MetaMask в будущем
    role              TEXT NOT NULL DEFAULT 'user'
                     CHECK (role IN ('user','pusher','admin')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2) триггер на updated_at – используем ту же функцию, что и для bad_addresses
CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
