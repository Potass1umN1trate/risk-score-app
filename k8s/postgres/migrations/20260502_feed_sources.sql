-- Migration: add feed_sources and flagged_address_sources tables
-- Idempotent — safe to run multiple times against an already-migrated DB.
-- Apply to any existing PostgreSQL PVC that was initialized before this
-- schema was added to initdb-configmap.yaml.
--
-- Usage:
--   kubectl exec -n risk-score-app <postgres-pod> -- \
--     psql -U riskapp -d riskscoredb -f /tmp/20260502_feed_sources.sql

-- =============================================
-- feed_sources
-- =============================================
CREATE TABLE IF NOT EXISTS feed_sources (
  id               CHAR(36)     PRIMARY KEY,
  code             VARCHAR(64)  NOT NULL UNIQUE,
  name             VARCHAR(128) NOT NULL,
  base_url         TEXT,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  last_success_at  TIMESTAMPTZ,
  last_attempt_at  TIMESTAMPTZ,
  last_error       TEXT,
  config_json      JSONB,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_feed_sources_updated_at'
      AND tgrelid = 'feed_sources'::regclass
  ) THEN
    CREATE TRIGGER trg_feed_sources_updated_at
      BEFORE UPDATE ON feed_sources
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =============================================
-- flagged_address_sources
-- =============================================
CREATE TABLE IF NOT EXISTS flagged_address_sources (
  id                  CHAR(36)      PRIMARY KEY,
  flagged_address_id  CHAR(36)      NOT NULL REFERENCES flagged_addresses(id) ON DELETE CASCADE,
  feed_source_id      CHAR(36)      NOT NULL REFERENCES feed_sources(id)      ON DELETE CASCADE,
  external_id         VARCHAR(255),
  source_category     VARCHAR(128),
  source_chain        VARCHAR(64),
  confidence          DECIMAL(5,2),
  trusted             BOOLEAN,
  checked             BOOLEAN,
  first_seen          TIMESTAMPTZ,
  last_seen           TIMESTAMPTZ,
  raw_payload_json    JSONB,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_flagged_address_sources_updated_at'
      AND tgrelid = 'flagged_address_sources'::regclass
  ) THEN
    CREATE TRIGGER trg_flagged_address_sources_updated_at
      BEFORE UPDATE ON flagged_address_sources
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fas_flagged_address
  ON flagged_address_sources (flagged_address_id);

CREATE INDEX IF NOT EXISTS idx_fas_feed_source
  ON flagged_address_sources (feed_source_id);

CREATE INDEX IF NOT EXISTS idx_fas_feed_source_external_id
  ON flagged_address_sources (feed_source_id, external_id)
  WHERE external_id IS NOT NULL;

-- Uniqueness: one evidence row per (source, external report, flagged address) when external_id present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'flagged_address_sources'
      AND indexname  = 'uq_fas_source_external_address'
  ) THEN
    CREATE UNIQUE INDEX uq_fas_source_external_address
      ON flagged_address_sources (feed_source_id, external_id, flagged_address_id)
      WHERE external_id IS NOT NULL;
  END IF;
END $$;

-- Uniqueness: one evidence row per (source, flagged address, category) when no external_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'flagged_address_sources'
      AND indexname  = 'uq_fas_source_address_category'
  ) THEN
    CREATE UNIQUE INDEX uq_fas_source_address_category
      ON flagged_address_sources (feed_source_id, flagged_address_id, source_category)
      NULLS NOT DISTINCT
      WHERE external_id IS NULL;
  END IF;
END $$;

-- =============================================
-- Seed: known feed sources (deterministic UUIDs, idempotent)
-- =============================================
INSERT INTO feed_sources (id, code, name, base_url, is_active) VALUES
  ('a1b2c3d4-0001-0001-0001-000000000001', 'chainabuse',   'Chainabuse',     'https://api.chainabuse.com/v0', TRUE),
  ('a1b2c3d4-0002-0002-0002-000000000002', 'ofac',          'OFAC SDN',       NULL,                           TRUE),
  ('a1b2c3d4-0003-0003-0003-000000000003', 'trm_sanctions', 'TRM Sanctions',  NULL,                           TRUE),
  ('a1b2c3d4-0004-0004-0004-000000000004', 'scamsniffer',   'ScamSniffer',    NULL,                           TRUE),
  ('a1b2c3d4-0005-0005-0005-000000000005', 'bitcoinabuse',  'BitcoinAbuse',   NULL,                           TRUE),
  ('a1b2c3d4-0006-0006-0006-000000000006', 'cryptoscamdb',  'CryptoScamDB',   NULL,                           TRUE)
ON CONFLICT (code) DO NOTHING;
