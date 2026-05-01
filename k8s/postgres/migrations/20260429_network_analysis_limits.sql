ALTER TABLE networks
  ADD COLUMN IF NOT EXISTS default_depth INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_depth INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS default_tx_limit INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_tx_limit INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS default_period_days INTEGER NULL,
  ADD COLUMN IF NOT EXISTS max_period_days INTEGER NOT NULL DEFAULT 3650;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_default_depth'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_default_depth
      CHECK (default_depth >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_max_depth'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_max_depth
      CHECK (max_depth >= default_depth);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_default_tx_limit'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_default_tx_limit
      CHECK (default_tx_limit >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_max_tx_limit'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_max_tx_limit
      CHECK (max_tx_limit >= default_tx_limit);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_default_period_days_min'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_default_period_days_min
      CHECK (default_period_days IS NULL OR default_period_days >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_max_period_days'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_max_period_days
      CHECK (max_period_days >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_default_period_days_max'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_default_period_days_max
      CHECK (default_period_days IS NULL OR default_period_days <= max_period_days);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_max_depth_cap'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_max_depth_cap
      CHECK (max_depth <= 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_max_tx_limit_cap'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_max_tx_limit_cap
      CHECK (max_tx_limit <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_networks_max_period_days_cap'
      AND conrelid = 'networks'::regclass
  ) THEN
    ALTER TABLE networks
      ADD CONSTRAINT chk_networks_max_period_days_cap
      CHECK (max_period_days <= 3650);
  END IF;
END $$;
