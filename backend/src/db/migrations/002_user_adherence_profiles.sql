-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002: user_adherence_profiles
--
-- One row per user.  Written exclusively by the nightly adherence computation
-- job (and updated in-place via UPSERT).  Mobile reads this via the strategy
-- API — never writes to it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_adherence_profiles (
  user_id             UUID         PRIMARY KEY,

  -- ─── Composite score ──────────────────────────────────────────────────────
  adherence_score     FLOAT        NOT NULL DEFAULT 1.0,
  risk_level          TEXT         NOT NULL DEFAULT 'LOW'
                      CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),

  -- ─── 7-day component metrics ──────────────────────────────────────────────
  adherence_rate      FLOAT        NOT NULL DEFAULT 1.0,   -- taken_on_time / total_scheduled
  avg_delay_minutes   FLOAT        NOT NULL DEFAULT 0.0,
  snooze_rate         FLOAT        NOT NULL DEFAULT 0.0,
  miss_rate           FLOAT        NOT NULL DEFAULT 0.0,
  consistency_score   FLOAT        NOT NULL DEFAULT 1.0,

  -- ─── Raw counts (for audit / future trend lines) ──────────────────────────
  last_7d_taken       INT          NOT NULL DEFAULT 0,
  last_7d_scheduled   INT          NOT NULL DEFAULT 0,
  last_30d_taken      INT          NOT NULL DEFAULT 0,
  last_30d_scheduled  INT          NOT NULL DEFAULT 0,

  computed_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Allows the strategy API to quickly serve the most-recently-computed profiles
-- without a full table scan when filtering by risk level or last compute time.
CREATE INDEX IF NOT EXISTS idx_profiles_risk_level
  ON user_adherence_profiles (risk_level);

CREATE INDEX IF NOT EXISTS idx_profiles_computed_at
  ON user_adherence_profiles (computed_at DESC);
