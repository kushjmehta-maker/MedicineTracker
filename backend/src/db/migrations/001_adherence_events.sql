-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001: adherence_events
--
-- Core event store.  Append-only.  Every dose lifecycle action is written here
-- from the mobile client.
--
-- Deduplication key: (dose_instance_id, event_type)
-- A single dose_instance can have at most one TRIGGERED, one TAKEN, one MISSED,
-- one SKIPPED, but SNOOZED can appear once per snooze (handled by application).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS adherence_events (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID         NOT NULL,
  dose_instance_id    UUID         NOT NULL,
  medication_id       UUID,

  event_type          TEXT         NOT NULL
                      CHECK (event_type IN ('TAKEN','SNOOZED','MISSED','TRIGGERED','SKIPPED')),

  scheduled_time_utc  TIMESTAMPTZ,
  action_time_utc     TIMESTAMPTZ  NOT NULL,
  delay_seconds       INT,         -- action_time - scheduled_time in seconds; negative = early
  snooze_count        INT          NOT NULL DEFAULT 0,
  device_tz           TEXT,
  app_version         TEXT,

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Deduplication index ──────────────────────────────────────────────────────
-- Enforces the ON CONFLICT DO NOTHING idempotency guarantee.
-- SNOOZED events use a different compound key (see application-layer comment).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_adherence_events_dedup
  ON adherence_events (dose_instance_id, event_type)
  WHERE event_type IN ('TAKEN', 'MISSED', 'SKIPPED', 'TRIGGERED');

-- ─── Query indexes ────────────────────────────────────────────────────────────
-- Used by nightly computation (range scan per user ordered by time)
CREATE INDEX IF NOT EXISTS idx_adherence_events_user_created
  ON adherence_events (user_id, action_time_utc DESC);

-- Used by idempotency check and dose history lookups
CREATE INDEX IF NOT EXISTS idx_adherence_events_dose
  ON adherence_events (dose_instance_id);

-- Used to find all active users for batch computation
CREATE INDEX IF NOT EXISTS idx_adherence_events_user
  ON adherence_events (user_id);
