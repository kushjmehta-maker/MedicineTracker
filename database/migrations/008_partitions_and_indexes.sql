-- =============================================================================
-- Migration 008: Partitions and covering indexes
--
-- Creates the initial set of monthly partitions for dose_instances and
-- adherence_events, a DEFAULT partition for overflow, and all performance-
-- critical indexes that span hot query paths.
--
-- Partition naming convention:
--   <table>_y<YYYY>_m<MM>
--   e.g. dose_instances_y2026_m04
--
-- How to extend partitions (run monthly via cron or pg_partman):
--   SELECT create_monthly_partitions('dose_instances', '2026-06-01', 3);
--   SELECT create_monthly_partitions('adherence_events', '2026-06-01', 3);
-- =============================================================================

-- ─── 1. dose_instances FK helper ─────────────────────────────────────────────
--
-- FKs cannot be declared on a partitioned parent in PG 15.  We attach them
-- on each partition after creation via this reusable procedure.

CREATE OR REPLACE PROCEDURE attach_dose_instance_fks(partition_name TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'ALTER TABLE %I
       ADD CONSTRAINT %I FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
       ADD CONSTRAINT %I FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE',
    partition_name,
    partition_name || '_fk_user',
    partition_name || '_fk_medication'
  );
END;
$$;

-- ─── 2. dose_instances — initial partitions ───────────────────────────────────

-- Current month (April 2026)
CREATE TABLE dose_instances_y2026_m04
  PARTITION OF dose_instances
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TRIGGER trg_dose_instances_y2026_m04_updated_at
  BEFORE UPDATE ON dose_instances_y2026_m04
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CALL attach_dose_instance_fks('dose_instances_y2026_m04');

-- Next month
CREATE TABLE dose_instances_y2026_m05
  PARTITION OF dose_instances
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TRIGGER trg_dose_instances_y2026_m05_updated_at
  BEFORE UPDATE ON dose_instances_y2026_m05
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CALL attach_dose_instance_fks('dose_instances_y2026_m05');

-- Buffer month (+2)
CREATE TABLE dose_instances_y2026_m06
  PARTITION OF dose_instances
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TRIGGER trg_dose_instances_y2026_m06_updated_at
  BEFORE UPDATE ON dose_instances_y2026_m06
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CALL attach_dose_instance_fks('dose_instances_y2026_m06');

-- DEFAULT partition catches rows outside defined ranges (scheduler look-ahead,
-- clock skew, edge cases).  Rows here are migrated to proper partitions nightly.
CREATE TABLE dose_instances_default
  PARTITION OF dose_instances DEFAULT;

CREATE TRIGGER trg_dose_instances_default_updated_at
  BEFORE UPDATE ON dose_instances_default
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CALL attach_dose_instance_fks('dose_instances_default');

-- ─── 3. adherence_events — initial partitions ─────────────────────────────────

CREATE TABLE adherence_events_y2026_m04
  PARTITION OF adherence_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TRIGGER trg_adherence_deny_delete_y2026_m04
  BEFORE DELETE ON adherence_events_y2026_m04
  FOR EACH ROW EXECUTE FUNCTION trigger_deny_delete_analytics_conditional();

CREATE TABLE adherence_events_y2026_m05
  PARTITION OF adherence_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TRIGGER trg_adherence_deny_delete_y2026_m05
  BEFORE DELETE ON adherence_events_y2026_m05
  FOR EACH ROW EXECUTE FUNCTION trigger_deny_delete_analytics_conditional();

CREATE TABLE adherence_events_y2026_m06
  PARTITION OF adherence_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TRIGGER trg_adherence_deny_delete_y2026_m06
  BEFORE DELETE ON adherence_events_y2026_m06
  FOR EACH ROW EXECUTE FUNCTION trigger_deny_delete_analytics_conditional();

CREATE TABLE adherence_events_default
  PARTITION OF adherence_events DEFAULT;

CREATE TRIGGER trg_adherence_deny_delete_default
  BEFORE DELETE ON adherence_events_default
  FOR EACH ROW EXECUTE FUNCTION trigger_deny_delete_analytics_conditional();

-- ─── 4. dose_instances indexes ────────────────────────────────────────────────
--
-- Created on the parent; PG 15 automatically propagates to all partitions.

-- Hot path 1: Mobile scheduler — "give me all SCHEDULED doses for user X
--             in the next 7 days" (used on every app open for missed detection)
CREATE INDEX idx_dose_user_time
  ON dose_instances (user_id, scheduled_time_utc DESC);

-- Hot path 2: Notification handler — "look up a dose by its ID"
--   UUIDs v7 are time-sortable so this index page-splits minimally.
CREATE INDEX idx_dose_id
  ON dose_instances (id);

-- Hot path 3: Scheduler — "find all SCHEDULED doses for a medication"
--             (used when a medication is updated or deactivated)
CREATE INDEX idx_dose_medication
  ON dose_instances (medication_id);

-- Covering index for missed-dose detector:
--   SELECT id, status, scheduled_time_utc, snoozed_until_utc, notification_id
--   WHERE user_id = ? AND status IN ('SCHEDULED','TRIGGERED','SNOOZED')
--   ORDER BY scheduled_time_utc
-- Index covers all projected columns so the query is index-only.
CREATE INDEX idx_dose_user_active_covering
  ON dose_instances (user_id, scheduled_time_utc, status)
  INCLUDE (id, notification_id, snoozed_until_utc, medication_id)
  WHERE status IN ('SCHEDULED','TRIGGERED','SNOOZED');

-- ─── 5. adherence_events indexes ──────────────────────────────────────────────

-- Nightly computation: range scan per user over the last 7/30 days
CREATE INDEX idx_adherence_user_time
  ON adherence_events (user_id, action_time_utc DESC);

-- Idempotency check: look up an event by dose + type
CREATE INDEX idx_adherence_dose
  ON adherence_events (dose_instance_id);

-- Covering index for the nightly SQL aggregation query:
--   SELECT event_type, delay_seconds, snooze_count
--   FROM adherence_events
--   WHERE user_id = ? AND action_time_utc >= NOW() - INTERVAL '7 days'
-- Covers all columns needed by AdherenceComputationService → no heap fetch.
CREATE INDEX idx_adherence_user_computation_covering
  ON adherence_events (user_id, action_time_utc)
  INCLUDE (event_type, delay_seconds, snooze_count);

-- ─── 6. Partition management utility ─────────────────────────────────────────
--
-- Creates N monthly partitions starting from start_month for the given table.
-- Call from a pg_cron job or maintenance script:
--   SELECT create_monthly_partitions('dose_instances', '2026-07-01'::DATE, 3);
--
-- This function is intentionally simple — use pg_partman for full automation.

CREATE OR REPLACE FUNCTION create_monthly_partitions(
  p_table      TEXT,
  p_start      DATE,
  p_count      INT DEFAULT 3
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_month      DATE := date_trunc('month', p_start);
  v_next_month DATE;
  v_suffix     TEXT;
  v_partition  TEXT;
BEGIN
  FOR i IN 0..(p_count - 1) LOOP
    v_month      := v_month + (i || ' months')::INTERVAL;
    v_next_month := v_month + INTERVAL '1 month';
    v_suffix     := to_char(v_month, '"y"YYYY"_m"MM');
    v_partition  := p_table || '_' || v_suffix;

    -- Skip if partition already exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = v_partition AND n.nspname = current_schema()
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        v_partition, p_table, v_month, v_next_month
      );

      -- Attach updated_at trigger for dose_instances partitions
      IF p_table = 'dose_instances' THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()',
          'trg_' || v_partition || '_updated_at', v_partition
        );
        CALL attach_dose_instance_fks(v_partition);
      END IF;

      -- Attach soft-delete guard for adherence_events partitions
      IF p_table = 'adherence_events' THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_deny_delete_analytics_conditional()',
          'trg_adherence_deny_delete_' || v_suffix, v_partition
        );
      END IF;

      RAISE NOTICE 'Created partition: %', v_partition;
    ELSE
      RAISE NOTICE 'Partition already exists, skipped: %', v_partition;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION create_monthly_partitions(TEXT, DATE, INT) IS
  'Creates N monthly range partitions for dose_instances or adherence_events. Idempotent.';
