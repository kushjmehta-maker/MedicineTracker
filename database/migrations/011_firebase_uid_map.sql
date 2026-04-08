-- =============================================================================
-- 011_firebase_uid_map.sql
--
-- Maps Firebase UIDs (opaque strings from Firebase Auth) to internal user
-- UUIDs.  Kept separate from the users table so we can:
--   • Support multiple auth providers per user in the future
--   • Swap auth providers without touching core user rows
-- =============================================================================

CREATE TABLE IF NOT EXISTS firebase_uid_map (
  firebase_uid  TEXT         NOT NULL,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT firebase_uid_map_pkey PRIMARY KEY (firebase_uid)
);

-- Fast reverse-lookup: given an internal user_id find the Firebase UID(s).
CREATE INDEX IF NOT EXISTS idx_firebase_uid_map_user_id
  ON firebase_uid_map (user_id);

-- Row-level security: users may only see their own mapping row.
ALTER TABLE firebase_uid_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY firebase_uid_map_self
  ON firebase_uid_map
  FOR ALL
  USING (user_id = (current_setting('app.current_user_id', TRUE))::uuid);

-- Service-role bypass (backend connects as the app role, not a row-level user).
-- Adjust role name to match your DB setup (e.g. 'app_service' or 'postgres').
CREATE POLICY firebase_uid_map_service_role
  ON firebase_uid_map
  AS PERMISSIVE
  FOR ALL
  TO app_service
  USING (TRUE);
