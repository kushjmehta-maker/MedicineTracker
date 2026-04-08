-- =============================================================================
-- Migration 010: Monetization — subscriptions, feature flags, plan limits
--
-- Five new tables + seed data for initial FREE / PREMIUM plan configuration.
-- All writes to subscriptions are idempotent; billing webhook events carry a
-- provider_subscription_id that acts as a dedup key.
--
-- Execution note: run AFTER migrations 001–009.  Depends on the users table
-- and uuid_generate_v7() from migration 001.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. subscriptions
--
-- One active subscription per user at any time (enforced by partial unique
-- index).  Historical rows are kept for audit; only the ACTIVE/TRIAL row
-- is queried at runtime.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE subscriptions (
  id                        UUID          NOT NULL DEFAULT uuid_generate_v7() PRIMARY KEY,
  user_id                   UUID          NOT NULL
                            REFERENCES users (id) ON DELETE CASCADE,

  plan_type                 VARCHAR(20)   NOT NULL,
  status                    VARCHAR(20)   NOT NULL,

  -- Billing window
  start_date                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  end_date                  TIMESTAMPTZ,            -- NULL = no expiry (e.g. annual until cancelled)

  -- Provider linkage
  provider                  VARCHAR(50),             -- PLAY_STORE | APPLE | INTERNAL | NULL (free)
  provider_subscription_id  VARCHAR(255),            -- Provider's own subscription/order ID

  -- Grace period: we keep the subscription ACTIVE for this many minutes
  -- after end_date to tolerate billing delays before downgrading.
  grace_period_minutes      INT           NOT NULL DEFAULT 1440,  -- 24 h default

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions
  ADD CONSTRAINT chk_sub_plan_type
  CHECK (plan_type IN ('FREE','PREMIUM','FAMILY'));

ALTER TABLE subscriptions
  ADD CONSTRAINT chk_sub_status
  CHECK (status IN ('ACTIVE','CANCELLED','EXPIRED','TRIAL'));

ALTER TABLE subscriptions
  ADD CONSTRAINT chk_sub_end_date_order
  CHECK (end_date IS NULL OR end_date > start_date);

ALTER TABLE subscriptions
  ADD CONSTRAINT chk_sub_grace_period_nonneg
  CHECK (grace_period_minutes >= 0);

-- Only one ACTIVE or TRIAL row per user at a time.
CREATE UNIQUE INDEX uidx_subscriptions_user_active
  ON subscriptions (user_id)
  WHERE status IN ('ACTIVE','TRIAL');

-- Dedup provider webhook replays: each provider subscription ID maps to
-- exactly one row in our system.
CREATE UNIQUE INDEX uidx_subscriptions_provider_id
  ON subscriptions (provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- Lookup: "give me the active sub for user X"
CREATE INDEX idx_subscriptions_user
  ON subscriptions (user_id);

-- Sweep: find subscriptions whose end_date + grace window has elapsed
CREATE INDEX idx_subscriptions_expiry_sweep
  ON subscriptions (end_date, grace_period_minutes)
  WHERE status IN ('ACTIVE','TRIAL') AND end_date IS NOT NULL;

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE  subscriptions                           IS 'One active subscription per user. Historical rows kept for audit.';
COMMENT ON COLUMN subscriptions.provider_subscription_id IS 'Provider receipt/order ID used for webhook dedup (unique per provider).';
COMMENT ON COLUMN subscriptions.grace_period_minutes     IS 'Minutes after end_date the subscription stays ACTIVE before expiry cron downgrades it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. feature_flags  (static config — drives feature gate decisions)
--
-- The application boots with a local cache of all active flags.
-- Toggling is_active = FALSE disables the feature across ALL plans immediately.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE feature_flags (
  key             VARCHAR(100)  NOT NULL PRIMARY KEY,
  description     TEXT,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE feature_flags IS 'Master list of all gatable features. Disabling is_active kills the feature for all plans.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. plan_features  (plan → feature enablement mapping)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE plan_features (
  id          UUID          NOT NULL DEFAULT uuid_generate_v7() PRIMARY KEY,
  plan_type   VARCHAR(20)   NOT NULL,
  feature_key VARCHAR(100)  NOT NULL REFERENCES feature_flags (key) ON DELETE CASCADE,
  is_enabled  BOOLEAN       NOT NULL DEFAULT TRUE,

  UNIQUE (plan_type, feature_key)
);

ALTER TABLE plan_features
  ADD CONSTRAINT chk_plan_features_plan_type
  CHECK (plan_type IN ('FREE','PREMIUM','FAMILY'));

CREATE INDEX idx_plan_features_plan
  ON plan_features (plan_type, feature_key);

COMMENT ON TABLE plan_features IS 'Per-plan feature enablement. Queried at startup and cached in memory.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. usage_limits  (per-plan numeric resource caps)
--
-- limit_value NULL means unlimited.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE usage_limits (
  id            UUID          NOT NULL DEFAULT uuid_generate_v7() PRIMARY KEY,
  plan_type     VARCHAR(20)   NOT NULL,
  metric_key    VARCHAR(100)  NOT NULL,
  limit_value   INT,          -- NULL = unlimited

  UNIQUE (plan_type, metric_key)
);

ALTER TABLE usage_limits
  ADD CONSTRAINT chk_usage_limits_plan_type
  CHECK (plan_type IN ('FREE','PREMIUM','FAMILY'));

ALTER TABLE usage_limits
  ADD CONSTRAINT chk_usage_limits_value_nonneg
  CHECK (limit_value IS NULL OR limit_value >= 0);

CREATE INDEX idx_usage_limits_plan
  ON usage_limits (plan_type, metric_key);

COMMENT ON TABLE usage_limits IS 'Per-plan resource caps. NULL limit_value means unlimited.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. usage_tracking  (per-user live counters)
--
-- One row per (user_id, metric_key).  Updated atomically via
-- INSERT ... ON CONFLICT DO UPDATE to prevent double-counts.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE usage_tracking (
  id              UUID          NOT NULL DEFAULT uuid_generate_v7() PRIMARY KEY,
  user_id         UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  metric_key      VARCHAR(100)  NOT NULL,
  current_value   INT           NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, metric_key)
);

ALTER TABLE usage_tracking
  ADD CONSTRAINT chk_usage_tracking_value_nonneg
  CHECK (current_value >= 0);

-- Hot path: "how many medicines does user X have?"
CREATE INDEX idx_usage_tracking_user_metric
  ON usage_tracking (user_id, metric_key);

CREATE TRIGGER trg_usage_tracking_updated_at
  BEFORE UPDATE ON usage_tracking
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE usage_tracking IS 'Per-user live usage counters. Incremented atomically; never goes negative.';

-- =============================================================================
-- SEED DATA — initial plan configuration
-- =============================================================================

-- ─── Feature flags ────────────────────────────────────────────────────────────

INSERT INTO feature_flags (key, description, is_active) VALUES
  ('reminders',                 'Core medicine reminders — always on for all plans',   TRUE),
  ('missed_dose_detection',     'Missed dose detection and nudges',                    TRUE),
  ('basic_adherence',           'Basic 7-day adherence percentage',                    TRUE),
  ('advanced_adherence',        'Full adherence analytics with trends and risk score', TRUE),
  ('adaptive_notifications',    'Adaptive notification intensity based on behavior',   TRUE),
  ('caregiver_access',          'Add and manage caregivers for family oversight',      TRUE),
  ('priority_notifications',    'Elevated notification priority and persistent alerts',TRUE),
  ('export_data',               'Export adherence history to PDF / CSV',               TRUE),
  ('unlimited_medicines',       'Add more than 10 medicines',                          TRUE),
  ('doctor_followups',          'Doctor appointment and lab test follow-up reminders', TRUE)
ON CONFLICT (key) DO NOTHING;

-- ─── Plan → feature mapping ───────────────────────────────────────────────────

-- FREE plan
INSERT INTO plan_features (id, plan_type, feature_key, is_enabled) VALUES
  (uuid_generate_v7(), 'FREE', 'reminders',              TRUE),
  (uuid_generate_v7(), 'FREE', 'missed_dose_detection',  TRUE),
  (uuid_generate_v7(), 'FREE', 'basic_adherence',        TRUE),
  (uuid_generate_v7(), 'FREE', 'advanced_adherence',     FALSE),
  (uuid_generate_v7(), 'FREE', 'adaptive_notifications', FALSE),
  (uuid_generate_v7(), 'FREE', 'caregiver_access',       FALSE),
  (uuid_generate_v7(), 'FREE', 'priority_notifications', FALSE),
  (uuid_generate_v7(), 'FREE', 'export_data',            FALSE),
  (uuid_generate_v7(), 'FREE', 'unlimited_medicines',    FALSE),
  (uuid_generate_v7(), 'FREE', 'doctor_followups',       TRUE)
ON CONFLICT (plan_type, feature_key) DO NOTHING;

-- PREMIUM plan
INSERT INTO plan_features (id, plan_type, feature_key, is_enabled) VALUES
  (uuid_generate_v7(), 'PREMIUM', 'reminders',              TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'missed_dose_detection',  TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'basic_adherence',        TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'advanced_adherence',     TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'adaptive_notifications', TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'caregiver_access',       TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'priority_notifications', TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'export_data',            TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'unlimited_medicines',    TRUE),
  (uuid_generate_v7(), 'PREMIUM', 'doctor_followups',       TRUE)
ON CONFLICT (plan_type, feature_key) DO NOTHING;

-- FAMILY plan (superset of PREMIUM)
INSERT INTO plan_features (id, plan_type, feature_key, is_enabled)
  SELECT uuid_generate_v7(), 'FAMILY', feature_key, is_enabled
  FROM plan_features
  WHERE plan_type = 'PREMIUM'
ON CONFLICT (plan_type, feature_key) DO NOTHING;

-- ─── Usage limits ─────────────────────────────────────────────────────────────

INSERT INTO usage_limits (id, plan_type, metric_key, limit_value) VALUES
  -- FREE
  (uuid_generate_v7(), 'FREE',    'medicines_count',   10),
  (uuid_generate_v7(), 'FREE',    'caregivers_count',   0),
  (uuid_generate_v7(), 'FREE',    'followups_count',    5),
  -- PREMIUM
  (uuid_generate_v7(), 'PREMIUM', 'medicines_count',  NULL),  -- unlimited
  (uuid_generate_v7(), 'PREMIUM', 'caregivers_count',    5),
  (uuid_generate_v7(), 'PREMIUM', 'followups_count',  NULL),
  -- FAMILY
  (uuid_generate_v7(), 'FAMILY',  'medicines_count',  NULL),
  (uuid_generate_v7(), 'FAMILY',  'caregivers_count',   20),
  (uuid_generate_v7(), 'FAMILY',  'followups_count',  NULL)
ON CONFLICT (plan_type, metric_key) DO NOTHING;
