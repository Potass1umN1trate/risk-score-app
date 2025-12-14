CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bad_addresses_set_updated_at ON bad_addresses;

CREATE TRIGGER trg_bad_addresses_set_updated_at
BEFORE UPDATE ON bad_addresses
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
