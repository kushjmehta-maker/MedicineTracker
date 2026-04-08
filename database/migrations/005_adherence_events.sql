-- =============================================================================
-- Migration 005: adherence_events
--
-- Append-only behavioral log.  Every dose lifecycle action from every device
-- lands here.  This supersedes the Phase-2 bootstrap migration
-- (backend/src/db/migrations/001_adherence_events.sql) which lacked FKs.
--
-- Volume estimate: ~5 events/dose × 1 M doses/day = 5 M rows/day.
-- Single table is fine to ~150 M rows; add monthly partitions beyond that.
-- The commented partition example at the bottom is the upgrade path.
--
-- Idempotency:
--   Terminal events (TAKEN, MISSED, SKIPPED, TRIGGERED) get a partial unique
--   index on (dose_instance_id, event_type).  SNOOZED is intentionally excluded
--   because a single dose can be snoozed N times.
--
-- Soft-delete guard:
--   The trigger_deny_delete_analytics() trigger (defined in migration 001)
--   blocks hard DELETEs.  To bypass in a migration, run:
--     SET LOCAL bypass_analytics_delete_guard = 'true';
--   before the DELETE statement within the same transaction.
-- =============================================================================

CREATE TABLE adherence_events (
  id                    UUID          NOT NULL DEFAULT uuid_generate_v7(),
  user_id               UUID          NOT NULL
                        REFERENCES users (id) ON DELETE RESTRICT,
  dose_instance_id      UUID          NOT NULL,  -- No FK: cross-partition join is expensive;
                                                  -- referential integrity enforced at service layer
  medication_id         UUID,                    -- Denormalized for query convenience

  event_type            VARCHAR(20)   NOT NULL,
  scheduled_time_utc    TIMESTAMPTZ,
  action_time_utc       TIMESTAMPTZ   NOT NULL,
  delay_seconds         INT,
  snooze_count          INT           NOT NULL DEFAULT 0,
  device_tz             VARCHAR(64),
  app_version           VARCHAR(32),

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, action_time_utc)   -- composite PK required for partitioning
)
PARTITION BY RANGE (action_time_utc);

-- ─── Constraints (inherited by all partitions) ────────────────────────────────

ALTER TABLE adherence_events
  ADD CONSTRAINT chk_adherence_event_type
  CHECK (event_type IN ('TAKEN','SNOOZED','MISSED','TRIGGERED','SKIPPED'));

ALTER TABLE adherence_events
  ADD CONSTRAINT chk_adherence_delay_seconds_range
  CHECK (delay_seconds IS NULL OR (delay_seconds >= -86400 AND delay_seconds <= 604800));

ALTER TABLE adherence_events
  ADD CONSTRAINT chk_adherence_snooze_nonneg
  CHECK (snooze_count >= 0);

-- action_time cannot be more than 60 seconds in the future (clock skew tolerance)
ALTER TABLE adherence_events
  ADD CONSTRAINT chk_adherence_action_time_not_future
  CHECK (action_time_utc <= NOW() + INTERVAL '60 seconds');

-- ─── Soft-delete guard trigger ────────────────────────────────────────────────
-- Blocks accidental hard-DELETEs.  Override per-session with:
--   SET LOCAL bypass_analytics_delete_guard = 'true';

CREATE OR REPLACE FUNCTION trigger_deny_delete_analytics_conditional()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('bypass_analytics_delete_guard', TRUE) = 'true' THEN
    RETURN OLD;  -- allow the DELETE in a migration context
  END IF;
  RAISE EXCEPTION
    'Hard deletes on adherence_events are disabled in production. '
    'Use soft-delete (set deleted_at) or SET LOCAL bypass_analytics_delete_guard = ''true'' in a migration.';
END;
$$;

-- NOTE: This trigger must be re-attached to each new monthly partition
-- (see the partition creation template in migration 008).
CREATE TRIGGER trg_adherence_events_deny_delete
  BEFORE DELETE ON adherence_events
  FOR EACH ROW EXECUTE FUNCTION trigger_deny_delete_analytics_conditional();

-- ─── Deduplication partial unique index ──────────────────────────────────────
-- PG 15 supports unique indexes on partitioned tables when the partition key
-- is included in the index.  We include action_time_utc (the partition key)
-- to satisfy this requirement.
--
-- The WHERE clause excludes SNOOZED (intentionally allowed multiple times).
CREATE UNIQUE INDEX uidx_adherence_events_dedup
  ON adherence_events (dose_instance_id, event_type, action_time_utc)
  WHERE event_type IN ('TAKEN','MISSED','SKIPPED','TRIGGERED');

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE  adherence_events                     IS 'Append-only behavioral log. Partitioned monthly by action_time_utc beyond 150 M rows.';
COMMENT ON COLUMN adherence_events.dose_instance_id    IS 'References dose_instances.id. No FK constraint: cross-partition FK not supported.';
COMMENT ON COLUMN adherence_events.medication_id       IS 'Denormalized from dose_instances for query convenience. Not enforced by FK.';
COMMENT ON COLUMN adherence_events.delay_seconds       IS 'action_time_utc - scheduled_time_utc in seconds. Negative = taken early.';

-- =============================================================================
-- PARTITION UPGRADE PATH (run manually when table exceeds ~150 M rows)
-- =============================================================================
-- Step 1: Create the partitioned replacement table (already done above).
-- Step 2: Create monthly partitions (see migration 008).
-- Step 3: To convert an existing unpartitioned table, use pg_partman or:
--
--   BEGIN;
--   ALTER TABLE adherence_events RENAME TO adherence_events_old;
--   CREATE TABLE adherence_events ( ... ) PARTITION BY RANGE (action_time_utc);
--   INSERT INTO adherence_events SELECT * FROM adherence_events_old;
--   DROP TABLE adherence_events_old;
--   COMMIT;
-- =============================================================================
