CREATE TABLE IF NOT EXISTS bad_addresses (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT,                      -- FK на таблицу пользователей (появится позже)
    blockchain    VARCHAR(16) NOT NULL,
    address       TEXT        NOT NULL,
    tag           TEXT,
    risk_level    SMALLINT    NOT NULL CHECK (risk_level BETWEEN 0 AND 100),
    source        TEXT,
    evidence_url  TEXT,
    first_seen_at TIMESTAMPTZ,
    last_seen_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_blockchain_address UNIQUE (blockchain, address)
);
