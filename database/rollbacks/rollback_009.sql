-- Rollback 009: Remove RLS policies and roles
BEGIN;

-- Drop policies
DROP POLICY IF EXISTS pol_users_self            ON users;
DROP POLICY IF EXISTS pol_medications_owner     ON medications;
DROP POLICY IF EXISTS pol_dose_instances_owner  ON dose_instances;
DROP POLICY IF EXISTS pol_adherence_events_owner ON adherence_events;
DROP POLICY IF EXISTS pol_profiles_owner        ON user_adherence_profiles;
DROP POLICY IF EXISTS pol_followups_owner       ON doctor_followups;

-- Disable RLS
ALTER TABLE users                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE medications             DISABLE ROW LEVEL SECURITY;
ALTER TABLE dose_instances          DISABLE ROW LEVEL SECURITY;
ALTER TABLE adherence_events        DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_adherence_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_followups        DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS app_current_user_id();

REVOKE ALL ON users                   FROM app_user;
REVOKE ALL ON medications             FROM app_user;
REVOKE ALL ON dose_instances          FROM app_user;
REVOKE ALL ON adherence_events        FROM app_user;
REVOKE ALL ON user_adherence_profiles FROM app_user;
REVOKE ALL ON user_adherence_profiles FROM app_migrator;
REVOKE ALL ON doctor_followups        FROM app_user;

DROP ROLE IF EXISTS app_user;
DROP ROLE IF EXISTS app_migrator;

COMMIT;
