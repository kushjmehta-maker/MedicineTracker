-- =============================================================================
-- Migration 003: medications
--
-- Master schedule table — one row per medicine the user is currently taking.
-- Dose instances are generated from these schedules by the mobile scheduler.
--
-- Design notes:
--   • schedule_times is JSONB: [{hour:8, minute:0, label:"Morning"}, ...]
--     Stored as structured JSON rather than a comma-separated string so the
--     mobile engine can round-trip it without parsing.
--   • frequency_type is constrained to a closed enum; new variants require
--     a migration rather than a silent data inconsistency.
--   • end_date NULL means the prescription is ongoing.
--   • missed_dose_window_minutes and max_snooze_count are per-medication
--     overrides that the mobile engine reads directly; the backend defaults
--     are stored in engine_config (not here).
--   • is_active = FALSE means future dose generation stops but history is kept.
-- =============================================================================

CREATE TABLE medications (
  id                          UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id                     UUID          NOT NULL
                              REFERENCES users (id) ON DELETE CASCADE,

  name                        VARCHAR(255)  NOT NULL,
  dosage                      VARCHAR(100),            -- e.g. "500mg", "1 tablet"
  frequency_type              VARCHAR(32)   NOT NULL,
  schedule_times              JSONB         NOT NULL,  -- [{hour, minute, label?}]
  start_date                  DATE          NOT NULL,
  end_date                    DATE,                    -- NULL = ongoing
  instructions                TEXT,

  -- ─── Adaptive overrides ─────────────────────────────────────────────────
  -- These mirror the EngineConfig defaults but can be tuned per-medication.
  -- NULL means "use the engine default".
  missed_dose_window_minutes  INT,
  max_snooze_count            INT,

  is_active                   BOOLEAN       NOT NULL DEFAULT TRUE,

  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Constraints ──────────────────────────────────────────────────────────────

ALTER TABLE medications
  ADD CONSTRAINT chk_medications_frequency_type
  CHECK (frequency_type IN ('DAILY','TWICE_DAILY','THREE_TIMES_DAILY','WEEKLY','CUSTOM'));

ALTER TABLE medications
  ADD CONSTRAINT chk_medications_date_order
  CHECK (end_date IS NULL OR end_date >= start_date);

ALTER TABLE medications
  ADD CONSTRAINT chk_medications_window_positive
  CHECK (missed_dose_window_minutes IS NULL OR missed_dose_window_minutes > 0);

ALTER TABLE medications
  ADD CONSTRAINT chk_medications_snooze_positive
  CHECK (max_snooze_count IS NULL OR max_snooze_count >= 0);

-- Validate schedule_times is a non-empty JSON array
ALTER TABLE medications
  ADD CONSTRAINT chk_medications_schedule_times_array
  CHECK (
    jsonb_typeof(schedule_times) = 'array'
    AND jsonb_array_length(schedule_times) > 0
  );

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Dashboard query: "show me all of user X's medications"
CREATE INDEX idx_medications_user
  ON medications (user_id);

-- Scheduler query: "give me all active medications for user X"
CREATE INDEX idx_medications_user_active
  ON medications (user_id, is_active)
  WHERE is_active = TRUE;

-- Expiry sweep: find medications whose end_date has passed so we can deactivate them
CREATE INDEX idx_medications_end_date
  ON medications (end_date)
  WHERE end_date IS NOT NULL AND is_active = TRUE;

-- ─── Triggers ─────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_medications_updated_at
  BEFORE UPDATE ON medications
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE  medications                        IS 'Master medication schedules. Dose instances are derived from these rows.';
COMMENT ON COLUMN medications.schedule_times         IS 'JSON array of {hour:int, minute:int, label?:string} objects in local time.';
COMMENT ON COLUMN medications.frequency_type         IS 'DAILY | TWICE_DAILY | THREE_TIMES_DAILY | WEEKLY | CUSTOM';
COMMENT ON COLUMN medications.missed_dose_window_minutes IS 'Per-medication override for miss detection window. NULL = use engine default (30 min).';
COMMENT ON COLUMN medications.max_snooze_count       IS 'Per-medication override for snooze cap. NULL = use engine default (3).';
