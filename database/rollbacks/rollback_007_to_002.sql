-- Rollback 007 → 002: Drop all domain tables in reverse FK order
-- WARNING: DESTROYS ALL DATA.  Only run in development or disaster recovery.
BEGIN;

DROP TABLE IF EXISTS doctor_followups         CASCADE;
DROP TABLE IF EXISTS user_adherence_profiles  CASCADE;
DROP TABLE IF EXISTS adherence_events         CASCADE;
DROP TABLE IF EXISTS dose_instances           CASCADE;
DROP TABLE IF EXISTS medications              CASCADE;
DROP TABLE IF EXISTS users                    CASCADE;

COMMIT;
