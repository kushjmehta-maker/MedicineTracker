-- =============================================================================
-- Migration 007: doctor_followups
--
-- Stores doctor appointments and lab-test follow-up events.
-- The mobile FollowUpReminderService generates T-24h and T-3h notifications
-- from the appointment_datetime_utc column.
--
-- Design notes:
--   • appointment_datetime_utc stores the full timestamp (not just date) so
--     T-24h and T-3h calculations are exact.
--   • notification_t24_id and notification_sameday_id mirror the Notifee
--     notification IDs so the mobile engine can cancel them on completion.
--   • followup_type allows future extension (LAB_TEST, PHARMACY_PICKUP, etc.)
--     without a schema change.
--   • is_completed + completed_at give a clean audit trail.
-- =============================================================================

CREATE TABLE doctor_followups (
  id                        UUID          NOT NULL DEFAULT uuid_generate_v7() PRIMARY KEY,
  user_id                   UUID          NOT NULL
                            REFERENCES users (id) ON DELETE CASCADE,

  title                     VARCHAR(255)  NOT NULL,
  doctor_name               VARCHAR(255),
  followup_type             VARCHAR(32)   NOT NULL DEFAULT 'DOCTOR_VISIT',
  description               TEXT,

  -- Full UTC timestamp so T-24h/T-3h math is exact
  appointment_datetime_utc  TIMESTAMPTZ   NOT NULL,

  -- Notifee notification IDs stored for cancellation
  notification_t24_id       TEXT,
  notification_sameday_id   TEXT,

  is_completed              BOOLEAN       NOT NULL DEFAULT FALSE,
  completed_at              TIMESTAMPTZ,

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Constraints ──────────────────────────────────────────────────────────────

ALTER TABLE doctor_followups
  ADD CONSTRAINT chk_followup_type
  CHECK (followup_type IN ('DOCTOR_VISIT','LAB_TEST','PHARMACY_PICKUP','OTHER'));

-- completed_at must be set if and only if is_completed = TRUE
ALTER TABLE doctor_followups
  ADD CONSTRAINT chk_followup_completed_consistency
  CHECK (
    (is_completed = FALSE AND completed_at IS NULL) OR
    (is_completed = TRUE  AND completed_at IS NOT NULL)
  );

ALTER TABLE doctor_followups
  ADD CONSTRAINT chk_followup_title_nonempty
  CHECK (char_length(trim(title)) > 0);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Mobile: "show me upcoming follow-ups for user X"
CREATE INDEX idx_followups_user_date
  ON doctor_followups (user_id, appointment_datetime_utc)
  WHERE is_completed = FALSE;

-- Sweep: find upcoming appointments for T-24h/T-3h notification scheduling
-- (called once daily by the backend cron or mobile app-open handler)
CREATE INDEX idx_followups_upcoming
  ON doctor_followups (appointment_datetime_utc)
  WHERE is_completed = FALSE;

-- ─── Trigger ─────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_followups_updated_at
  BEFORE UPDATE ON doctor_followups
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE  doctor_followups                         IS 'Doctor appointments and lab-test follow-up events.';
COMMENT ON COLUMN doctor_followups.appointment_datetime_utc IS 'Full UTC timestamp for the appointment. T-24h and T-3h alarms are computed from this.';
COMMENT ON COLUMN doctor_followups.notification_t24_id      IS 'Notifee alarm ID for the T-24h reminder. Stored for cancellation.';
COMMENT ON COLUMN doctor_followups.notification_sameday_id  IS 'Notifee alarm ID for the same-day (T-3h) reminder. Stored for cancellation.';
COMMENT ON COLUMN doctor_followups.followup_type            IS 'DOCTOR_VISIT | LAB_TEST | PHARMACY_PICKUP | OTHER';
