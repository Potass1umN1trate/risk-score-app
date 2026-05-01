ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_role VARCHAR(16) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_audit_logs_actor_role'
      AND conrelid = 'audit_logs'::regclass
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT chk_audit_logs_actor_role
      CHECK (actor_role IN ('user', 'moderator', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_role
  ON audit_logs (actor_role, created_at DESC);
