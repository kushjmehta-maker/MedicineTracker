-- =============================================================================
-- Migration 002: users
--
-- Minimal user table.  Auth (tokens, sessions, OTP) is handled by a separate
-- auth service; this table is the FK anchor for every domain entity.
--
-- Design notes:
--   • phone_number is the primary login identifier for the Indian market
--   • timezone defaults to Asia/Kolkata; recalculated on every app foreground
--   • preferred_language drives notification copy (future i18n)
--   • deleted_at enables soft-delete so FK rows in child tables are not orphaned
-- =============================================================================

CREATE TABLE users (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_number        VARCHAR(20)   NOT NULL,
  name                VARCHAR(120),
  preferred_language  VARCHAR(10)   NOT NULL DEFAULT 'en',
  timezone            VARCHAR(64)   NOT NULL DEFAULT 'Asia/Kolkata',

  -- ─── Soft-delete ────────────────────────────────────────────────────────
  -- Set deleted_at rather than hard-deleting so child rows remain queryable
  -- for analytics and legal retention.
  deleted_at          TIMESTAMPTZ,

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Constraints ──────────────────────────────────────────────────────────────

-- Phone numbers must be unique among non-deleted users only.
-- A deleted account should not block re-registration with the same number.
CREATE UNIQUE INDEX uidx_users_phone_active
  ON users (phone_number)
  WHERE deleted_at IS NULL;

-- Validate IANA timezone strings at the DB level using AT TIME ZONE cast.
-- This fires on INSERT and UPDATE and rejects garbage like "Foo/Bar".
ALTER TABLE users
  ADD CONSTRAINT chk_users_timezone_valid
  CHECK (
    NOW() AT TIME ZONE timezone IS NOT NULL
  );

-- Language codes: ISO 639-1 two-letter or BCP 47 (e.g. 'hi', 'ta', 'en-IN')
ALTER TABLE users
  ADD CONSTRAINT chk_users_language_nonempty
  CHECK (char_length(trim(preferred_language)) > 0);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- OTP/auth service looks users up by phone
CREATE INDEX idx_users_phone
  ON users (phone_number);

-- Soft-delete sweep: find recently deleted accounts for purge jobs
CREATE INDEX idx_users_deleted_at
  ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ─── Triggers ─────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE  users                     IS 'Platform user accounts. Auth tokens managed externally.';
COMMENT ON COLUMN users.id                  IS 'UUID v7 — time-sortable primary key.';
COMMENT ON COLUMN users.phone_number        IS 'E.164-formatted phone number (e.g. +919876543210).';
COMMENT ON COLUMN users.timezone            IS 'IANA timezone string. Updated on every app foreground.';
COMMENT ON COLUMN users.deleted_at          IS 'Soft-delete timestamp. NULL = active account.';
