-- =============================================================================
-- Migration 004: dose_instances
--
-- One row per scheduled dose event.  This is the highest-volume mutable table:
-- the mobile scheduler writes rows here; the state engine mutates status.
--
-- Partition strategy:
--   Range-partition by scheduled_time_utc (monthly).
--   At ~2 doses/day × 500k users = 1 M rows/day → 30 M rows/month.
--   Each partition stays within a manageable B-tree index depth.
--
-- Declarative partitioning is activated here.  The parent table holds no data;
-- all rows live in child partitions.  Migration 008 creates the first two
-- monthly partitions and a DEFAULT partition for overflow.
--
-- Design notes:
--   • notification_id mirrors the Notifee notification ID for cancellation.
--   • snoozed_until_utc is the epoch for the snooze alarm; NULL when not snoozed.
--   • The (user_id, scheduled_time_utc) UNIQUE constraint lives on each child
--     partition because global unique indexes are not supported across
--     partitioned tables in PG 15.  The service layer enforces idempotency.
-- =============================================================================

CREATE TABLE dose_instances (
  id                    UUID          NOT NULL DEFAULT uuid_generate_v7(),
  user_id               UUID          NOT NULL,   -- FK enforced per-partition (see below)
  medication_id         UUID          NOT NULL,   -- FK enforced per-partition

  scheduled_time_utc    TIMESTAMPTZ   NOT NULL,   -- partition key
  status                VARCHAR(20)   NOT NULL DEFAULT 'SCHEDULED',
  snooze_count          INT           NOT NULL DEFAULT 0,
  notification_id       TEXT,                     -- Notifee alarm ID
  snoozed_until_utc     TIMESTAMPTZ,
  taken_at              TIMESTAMPTZ,
  missed_at             TIMESTAMPTZ,
  skipped_at            TIMESTAMPTZ,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
)
PARTITION BY RANGE (scheduled_time_utc);

-- ─── Table-level constraints (inherited by all partitions) ────────────────────

ALTER TABLE dose_instances
  ADD CONSTRAINT chk_dose_status
  CHECK (status IN ('SCHEDULED','TRIGGERED','TAKEN','SNOOZED','MISSED','SKIPPED'));

ALTER TABLE dose_instances
  ADD CONSTRAINT chk_dose_snooze_count_nonneg
  CHECK (snooze_count >= 0);

-- Only one terminal timestamp should be populated at a time
ALTER TABLE dose_instances
  ADD CONSTRAINT chk_dose_terminal_exclusion
  CHECK (
    (CASE WHEN taken_at   IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN missed_at  IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN skipped_at IS NOT NULL THEN 1 ELSE 0 END) <= 1
  );

-- snoozed_until must be in the future relative to the scheduled time
ALTER TABLE dose_instances
  ADD CONSTRAINT chk_dose_snoozed_until_order
  CHECK (snoozed_until_utc IS NULL OR snoozed_until_utc > scheduled_time_utc);

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE  dose_instances                   IS 'Partitioned (monthly) time-series of scheduled dose events. Partition key: scheduled_time_utc.';
COMMENT ON COLUMN dose_instances.notification_id   IS 'Notifee alarm ID stored so the mobile engine can cancel stale alarms.';
COMMENT ON COLUMN dose_instances.snoozed_until_utc IS 'UTC timestamp for the active snooze alarm. NULL when not snoozed.';
COMMENT ON COLUMN dose_instances.status            IS 'SCHEDULED | TRIGGERED | TAKEN | SNOOZED | MISSED | SKIPPED';
