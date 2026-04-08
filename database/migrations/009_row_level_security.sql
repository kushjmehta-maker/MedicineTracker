-- =============================================================================
-- Migration 009: Row-level security (RLS)
--
-- Ensures that even if application-layer bugs bypass user filtering, the DB
-- itself refuses to return rows belonging to another user.
--
-- Pattern:
--   • Each table has an RLS policy that checks
--     user_id = current_setting('app.current_user_id')::UUID
--   • The backend sets this parameter at connection checkout:
--       SET LOCAL app.current_user_id = '<uuid>';
--   • A dedicated app role (app_user) is used for all application queries.
--     It never has BYPASSRLS privilege.
--   • The migration role (app_migrator) has BYPASSRLS so migrations work.
--
-- To enable in the application, before every query:
--   SET LOCAL app.current_user_id = '<user-uuid>';
-- =============================================================================

-- ─── Application roles ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

-- Grant table-level access to the application role
GRANT SELECT, INSERT, UPDATE        ON users                    TO app_user;
GRANT SELECT, INSERT, UPDATE        ON medications              TO app_user;
GRANT SELECT, INSERT, UPDATE        ON dose_instances           TO app_user;
GRANT SELECT, INSERT                ON adherence_events         TO app_user;
GRANT SELECT                        ON user_adherence_profiles  TO app_user;
GRANT SELECT, INSERT, UPDATE        ON doctor_followups         TO app_user;

-- Cron / computation worker writes profiles
GRANT INSERT, UPDATE                ON user_adherence_profiles  TO app_migrator;

-- ─── Enable RLS ───────────────────────────────────────────────────────────────

ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dose_instances          ENABLE ROW LEVEL SECURITY;
ALTER TABLE adherence_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_adherence_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_followups        ENABLE ROW LEVEL SECURITY;

-- FORCE RLS even for table owners (safety belt)
ALTER TABLE users                   FORCE ROW LEVEL SECURITY;
ALTER TABLE medications             FORCE ROW LEVEL SECURITY;
ALTER TABLE dose_instances          FORCE ROW LEVEL SECURITY;
ALTER TABLE adherence_events        FORCE ROW LEVEL SECURITY;
ALTER TABLE user_adherence_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE doctor_followups        FORCE ROW LEVEL SECURITY;

-- ─── Helper: get current user ID from session setting ─────────────────────────

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.current_user_id', TRUE)::UUID;
$$;

COMMENT ON FUNCTION app_current_user_id() IS
  'Returns the UUID of the authenticated user from the session-local setting app.current_user_id.';

-- ─── RLS policies ─────────────────────────────────────────────────────────────

-- users: a user can read/write only their own row
CREATE POLICY pol_users_self
  ON users
  USING       (id = app_current_user_id())
  WITH CHECK  (id = app_current_user_id());

-- medications: scoped to owning user
CREATE POLICY pol_medications_owner
  ON medications
  USING       (user_id = app_current_user_id())
  WITH CHECK  (user_id = app_current_user_id());

-- dose_instances: scoped to owning user
CREATE POLICY pol_dose_instances_owner
  ON dose_instances
  USING       (user_id = app_current_user_id())
  WITH CHECK  (user_id = app_current_user_id());

-- adherence_events: read own rows; insert own rows only
CREATE POLICY pol_adherence_events_owner
  ON adherence_events
  USING       (user_id = app_current_user_id())
  WITH CHECK  (user_id = app_current_user_id());

-- user_adherence_profiles: read own row only (cron writes as app_migrator)
CREATE POLICY pol_profiles_owner
  ON user_adherence_profiles
  USING       (user_id = app_current_user_id());

-- doctor_followups: scoped to owning user
CREATE POLICY pol_followups_owner
  ON doctor_followups
  USING       (user_id = app_current_user_id())
  WITH CHECK  (user_id = app_current_user_id());

-- ─── Cron worker bypass ───────────────────────────────────────────────────────
-- The nightly computation worker connects as app_migrator which has BYPASSRLS,
-- so it can read all users' adherence_events and write all profiles without
-- setting app.current_user_id per row.

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON POLICY pol_users_self         ON users                   IS 'Users may only read/write their own row.';
COMMENT ON POLICY pol_medications_owner  ON medications             IS 'Users may only access their own medications.';
COMMENT ON POLICY pol_dose_instances_owner ON dose_instances        IS 'Users may only access their own dose instances.';
COMMENT ON POLICY pol_adherence_events_owner ON adherence_events    IS 'Users may only read/insert their own events.';
COMMENT ON POLICY pol_profiles_owner     ON user_adherence_profiles IS 'Users may only read their own profile. Cron writes via BYPASSRLS role.';
COMMENT ON POLICY pol_followups_owner    ON doctor_followups        IS 'Users may only access their own follow-ups.';
