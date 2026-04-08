-- Rollback 008: Drop partitions, indexes, and management utilities
BEGIN;

DROP FUNCTION  IF EXISTS create_monthly_partitions(TEXT, DATE, INT);
DROP PROCEDURE IF EXISTS attach_dose_instance_fks(TEXT);

-- Drop dose_instances partitions (data loss — only run in dev/test)
DROP TABLE IF EXISTS dose_instances_y2026_m04;
DROP TABLE IF EXISTS dose_instances_y2026_m05;
DROP TABLE IF EXISTS dose_instances_y2026_m06;
DROP TABLE IF EXISTS dose_instances_default;

-- Drop adherence_events partitions
DROP TABLE IF EXISTS adherence_events_y2026_m04;
DROP TABLE IF EXISTS adherence_events_y2026_m05;
DROP TABLE IF EXISTS adherence_events_y2026_m06;
DROP TABLE IF EXISTS adherence_events_default;

-- Drop indexes (parent table indexes are auto-dropped with partitions,
-- but drop explicitly in case they were created separately)
DROP INDEX IF EXISTS idx_dose_user_time;
DROP INDEX IF EXISTS idx_dose_id;
DROP INDEX IF EXISTS idx_dose_medication;
DROP INDEX IF EXISTS idx_dose_user_active_covering;
DROP INDEX IF EXISTS idx_adherence_user_time;
DROP INDEX IF EXISTS idx_adherence_dose;
DROP INDEX IF EXISTS idx_adherence_user_computation_covering;

COMMIT;
