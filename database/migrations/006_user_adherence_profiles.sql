-- =============================================================================
-- Migration 006: user_adherence_profiles
--
-- One row per user.  Written exclusively by the nightly cron; read exclusively
-- by the notification strategy API.  Supersedes the Phase-2 bootstrap
-- migration (002_user_adherence_profiles.sql) — adds FK, fuller counts,
-- and change-tracking.
--
-- Design notes:
--   • No partitioning needed: one row per user, bounded to user table size.
--   • All float columns store values in [0, 1] except avg_delay_minutes.
--   • version column enables optimistic-locking in the cron job:
--       UPDATE ... WHERE user_id = $1 AND version = $2
--       RETURNING version;
--     If 0 rows updated, another worker won the race → skip.
-- =============================================================================

CREATE TABLE user_adherence_profiles (
  user_id               UUID          PRIMARY KEY
                        REFERENCES users (id) ON DELETE CASCADE,

  -- ─── Composite adherence score (0.0 – 1.0) ───────────────────────────────
  adherence_score       FLOAT         NOT NULL DEFAULT 1.0,
  risk_level            VARCHAR(10)   NOT NULL DEFAULT 'LOW',

  -- ─── 7-day component metrics ─────────────────────────────────────────────
  adherence_rate        FLOAT         NOT NULL DEFAULT 1.0,
  avg_delay_minutes     FLOAT         NOT NULL DEFAULT 0.0,
  snooze_rate           FLOAT         NOT NULL DEFAULT 0.0,
  miss_rate             FLOAT         NOT NULL DEFAULT 0.0,
  consistency_score     FLOAT         NOT NULL DEFAULT 1.0,

  -- ─── Raw counts for trend lines and audit ────────────────────────────────
  last_7d_taken         INT           NOT NULL DEFAULT 0,
  last_7d_scheduled     INT           NOT NULL DEFAULT 0,
  last_30d_taken        INT           NOT NULL DEFAULT 0,
  last_30d_scheduled    INT           NOT NULL DEFAULT 0,

  -- ─── Change tracking ─────────────────────────────────────────────────────
  -- version is incremented on each upsert — used for optimistic locking
  -- by the cron job to detect concurrent write races.
  version               INT           NOT NULL DEFAULT 0,
  computed_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Constraints ──────────────────────────────────────────────────────────────

ALTER TABLE user_adherence_profiles
  ADD CONSTRAINT chk_profile_risk_level
  CHECK (risk_level IN ('LOW','MEDIUM','HIGH'));

ALTER TABLE user_adherence_profiles
  ADD CONSTRAINT chk_profile_score_range
  CHECK (adherence_score BETWEEN 0.0 AND 1.0);

ALTER TABLE user_adherence_profiles
  ADD CONSTRAINT chk_profile_rate_ranges
  CHECK (
    adherence_rate    BETWEEN 0.0 AND 1.0 AND
    snooze_rate       BETWEEN 0.0 AND 1.0 AND
    miss_rate         BETWEEN 0.0 AND 1.0 AND
    consistency_score BETWEEN 0.0 AND 1.0
  );

ALTER TABLE user_adherence_profiles
  ADD CONSTRAINT chk_profile_avg_delay_nonneg
  CHECK (avg_delay_minutes >= 0.0);

ALTER TABLE user_adherence_profiles
  ADD CONSTRAINT chk_profile_counts_nonneg
  CHECK (
    last_7d_taken      >= 0 AND
    last_7d_scheduled  >= 0 AND
    last_30d_taken     >= 0 AND
    last_30d_scheduled >= 0
  );

-- ─── Upsert helper: auto-increment version ────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_profile_increment_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version    = OLD.version + 1;
  NEW.created_at = OLD.created_at;   -- Preserve original creation timestamp on updates
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profile_increment_version
  BEFORE UPDATE ON user_adherence_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_profile_increment_version();

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Strategy API: look up a single user
-- (covered by PRIMARY KEY — no extra index needed)

-- Operational dashboard: count users per risk tier
CREATE INDEX idx_profiles_risk_level
  ON user_adherence_profiles (risk_level);

-- Cron job: find stale profiles (not computed in last 26 hours)
CREATE INDEX idx_profiles_computed_at
  ON user_adherence_profiles (computed_at DESC);

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE  user_adherence_profiles              IS 'Precomputed nightly by cron. One row per user. Strategy API reads this.';
COMMENT ON COLUMN user_adherence_profiles.version      IS 'Incremented on each cron upsert. Used for optimistic locking to detect concurrent writes.';
COMMENT ON COLUMN user_adherence_profiles.adherence_score IS 'Composite score in [0,1]. Formula: 0.5×adherence_rate + 0.2×delay_score + 0.2×snooze_score + 0.1×consistency_score.';
