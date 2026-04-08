-- Rollback 001: Drop shared functions and extensions
-- WARNING: Extensions may be used by other databases in the same cluster.
-- Only drop them if this is a dedicated database.
BEGIN;

DROP FUNCTION  IF EXISTS trigger_deny_delete_analytics();
DROP FUNCTION  IF EXISTS trigger_set_updated_at();
DROP FUNCTION  IF EXISTS uuid_generate_v7();

-- Only drop extensions if no other schemas depend on them
-- DROP EXTENSION IF EXISTS "pgcrypto";
-- DROP EXTENSION IF EXISTS "uuid-ossp";

COMMIT;
