CREATE TABLE IF NOT EXISTS analysis_history (
    id               BIGSERIAL PRIMARY KEY,
    user_id          BIGINT,               -- на будущее: FK на таблицу пользователей
    address          TEXT        NOT NULL,
    blockchain       VARCHAR(16) NOT NULL,
    depth            INTEGER     NOT NULL,
    global_risk_score INTEGER    NOT NULL,
    result_json      JSONB       NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_history_user_created
    ON analysis_history (user_id, created_at DESC);
