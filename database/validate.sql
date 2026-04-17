-- =============================================================================
-- Schema Validation Suite
--
-- Run this against any environment after migrations to confirm the schema is
-- production-ready.  All assertions use RAISE EXCEPTION so a single failure
-- aborts the script with a clear message.
--
-- Usage:
--   psql $DATABASE_URL -f database/validate.sql
--
-- All checks run inside a transaction that is rolled back at the end so no
-- test data is committed.
-- =============================================================================

BEGIN;

-- ─── Helper ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _assert(condition BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', message;
  END IF;
END;
$$;

-- ─── 1. Extensions ──────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM _assert(
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'),
    'Extension uuid-ossp must be installed'
  );
  PERFORM _assert(
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'),
    'Extension pgcrypto must be installed'
  );
  RAISE NOTICE '  [PASS] Extensions present';
END;
$$;

-- ─── 2. uuid_generate_v7 produces valid UUIDs ──────────────────────────────

DO $$
DECLARE
  v1 UUID := uuid_generate_v7();
  v2 UUID := uuid_generate_v7();
BEGIN
  PERFORM _assert(v1 IS NOT NULL, 'uuid_generate_v7() must return non-null');
  PERFORM _assert(v1 <> v2, 'uuid_generate_v7() must produce unique values');
  PERFORM _assert(substring(v1::TEXT, 15, 1) = '7', 'uuid_generate_v7() version nibble must be 7');
  PERFORM _assert(substring(v1::TEXT, 20, 1) = ANY(ARRAY['8','9','a','b']),
    'uuid_generate_v7() variant bits must be RFC 4122 compliant');
  RAISE NOTICE '  [PASS] uuid_generate_v7() generates valid time-sortable UUIDs';
END;
$$;

-- ─── 3. Tables exist ────────────────────────────────────────────────────────

DO $$
DECLARE
  required_tables TEXT[] := ARRAY[
    'users', 'medications', 'dose_instances',
    'adherence_events', 'user_adherence_profiles', 'doctor_followups'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY required_tables LOOP
    PERFORM _assert(
      EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = t AND n.nspname = current_schema()
      ),
      format('Table %I must exist', t)
    );
  END LOOP;
  RAISE NOTICE '  [PASS] All required tables exist';
END;
$$;

-- ─── 4. dose_instances and adherence_events are partitioned ─────────────────

DO $$
BEGIN
  PERFORM _assert(
    EXISTS (
      SELECT 1 FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
      WHERE c.relname = 'dose_instances'
    ),
    'dose_instances must be a partitioned table'
  );
  PERFORM _assert(
    EXISTS (
      SELECT 1 FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
      WHERE c.relname = 'adherence_events'
    ),
    'adherence_events must be a partitioned table'
  );
  RAISE NOTICE '  [PASS] dose_instances and adherence_events are partitioned';
END;
$$;

-- ─── 5. Initial partitions exist ────────────────────────────────────────────

DO $$
DECLARE
  required_partitions TEXT[] := ARRAY[
    'dose_instances_y2026_m04',
    'dose_instances_y2026_m05',
    'dose_instances_y2026_m06',
    'dose_instances_default',
    'adherence_events_y2026_m04',
    'adherence_events_y2026_m05',
    'adherence_events_y2026_m06',
    'adherence_events_default'
  ];
  p TEXT;
BEGIN
  FOREACH p IN ARRAY required_partitions LOOP
    PERFORM _assert(
      EXISTS (SELECT 1 FROM pg_class WHERE relname = p),
      format('Partition %I must exist', p)
    );
  END LOOP;
  RAISE NOTICE '  [PASS] All initial partitions exist';
END;
$$;

-- ─── 6. Covering indexes exist ──────────────────────────────────────────────

DO $$
DECLARE
  required_indexes TEXT[] := ARRAY[
    'idx_dose_user_time',
    'idx_dose_user_active_covering',
    'idx_adherence_user_time',
    'idx_adherence_user_computation_covering',
    'idx_adherence_dose',
    'uidx_adherence_events_dedup',
    'idx_profiles_risk_level',
    'idx_followups_user_date',
    'idx_followups_upcoming'
  ];
  i TEXT;
BEGIN
  FOREACH i IN ARRAY required_indexes LOOP
    PERFORM _assert(
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = i),
      format('Index %I must exist', i)
    );
  END LOOP;
  RAISE NOTICE '  [PASS] All required indexes exist';
END;
$$;

-- ─── 7. CHECK constraints fire correctly ────────────────────────────────────

-- 7a. Invalid frequency_type rejected
DO $$
BEGIN
  BEGIN
    INSERT INTO users (id, phone_number) VALUES (uuid_generate_v7(), '+919999999901');
    INSERT INTO medications (id, user_id, name, frequency_type, schedule_times, start_date)
    VALUES (
      uuid_generate_v7(),
      (SELECT id FROM users WHERE phone_number = '+919999999901'),
      'TestMed', 'HOURLY',
      '[{"hour":8,"minute":0}]'::JSONB,
      CURRENT_DATE
    );
    RAISE EXCEPTION 'SHOULD HAVE BEEN REJECTED: invalid frequency_type accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE '  [PASS] Invalid frequency_type rejected by CHECK constraint';
END;
$$;

-- 7b. Invalid risk_level rejected
DO $$
BEGIN
  BEGIN
    INSERT INTO users (id, phone_number) VALUES (uuid_generate_v7(), '+919999999902');
    INSERT INTO user_adherence_profiles (user_id, adherence_score, risk_level, computed_at)
    VALUES (
      (SELECT id FROM users WHERE phone_number = '+919999999902'),
      0.5, 'CRITICAL',
      NOW()
    );
    RAISE EXCEPTION 'SHOULD HAVE BEEN REJECTED: invalid risk_level accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE '  [PASS] Invalid risk_level rejected by CHECK constraint';
END;
$$;

-- 7c. Invalid dose status rejected
DO $$
DECLARE
  v_user_id UUID := uuid_generate_v7();
  v_med_id  UUID := uuid_generate_v7();
BEGIN
  BEGIN
    INSERT INTO users (id, phone_number) VALUES (v_user_id, '+919999999903');
    INSERT INTO medications (id, user_id, name, frequency_type, schedule_times, start_date)
    VALUES (v_med_id, v_user_id, 'Med', 'DAILY', '[{"hour":8,"minute":0}]'::JSONB, CURRENT_DATE);
    INSERT INTO dose_instances (id, user_id, medication_id, scheduled_time_utc, status)
    VALUES (uuid_generate_v7(), v_user_id, v_med_id, NOW() + INTERVAL '1 hour', 'EATEN');
    RAISE EXCEPTION 'SHOULD HAVE BEEN REJECTED: invalid dose status accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE '  [PASS] Invalid dose status rejected by CHECK constraint';
END;
$$;

-- 7d. adherence_score outside [0,1] rejected
DO $$
BEGIN
  BEGIN
    INSERT INTO users (id, phone_number) VALUES (uuid_generate_v7(), '+919999999904');
    INSERT INTO user_adherence_profiles (user_id, adherence_score, risk_level, computed_at)
    VALUES (
      (SELECT id FROM users WHERE phone_number = '+919999999904'),
      1.5, 'LOW', NOW()
    );
    RAISE EXCEPTION 'SHOULD HAVE BEEN REJECTED: adherence_score > 1.0 accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE '  [PASS] Out-of-range adherence_score rejected';
END;
$$;

-- 7e. schedule_times must be a non-empty JSON array
DO $$
BEGIN
  BEGIN
    INSERT INTO users (id, phone_number) VALUES (uuid_generate_v7(), '+919999999905');
    INSERT INTO medications (id, user_id, name, frequency_type, schedule_times, start_date)
    VALUES (
      uuid_generate_v7(),
      (SELECT id FROM users WHERE phone_number = '+919999999905'),
      'Med', 'DAILY',
      '[]'::JSONB,
      CURRENT_DATE
    );
    RAISE EXCEPTION 'SHOULD HAVE BEEN REJECTED: empty schedule_times array accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE '  [PASS] Empty schedule_times array rejected';
END;
$$;

-- ─── 8. Deduplication: terminal events cannot be inserted twice ─────────────

DO $$
DECLARE
  v_user_id UUID := uuid_generate_v7();
  v_med_id  UUID := uuid_generate_v7();
  v_dose_id UUID := uuid_generate_v7();
  v_ts      TIMESTAMPTZ := NOW() - INTERVAL '1 hour';
  v_action  TIMESTAMPTZ := NOW() - INTERVAL '58 minutes';
BEGIN
  INSERT INTO users (id, phone_number) VALUES (v_user_id, '+919999999906');
  INSERT INTO medications (id, user_id, name, frequency_type, schedule_times, start_date)
  VALUES (v_med_id, v_user_id, 'Med', 'DAILY', '[{"hour":8,"minute":0}]'::JSONB, CURRENT_DATE);
  INSERT INTO dose_instances (id, user_id, medication_id, scheduled_time_utc)
  VALUES (v_dose_id, v_user_id, v_med_id, v_ts);

  INSERT INTO adherence_events (id, user_id, dose_instance_id, event_type, action_time_utc)
  VALUES (uuid_generate_v7(), v_user_id, v_dose_id, 'TAKEN', v_action);

  INSERT INTO adherence_events (id, user_id, dose_instance_id, event_type, action_time_utc)
  VALUES (uuid_generate_v7(), v_user_id, v_dose_id, 'TAKEN', v_action)
  ON CONFLICT (dose_instance_id, event_type, action_time_utc)
  WHERE event_type IN ('TAKEN','MISSED','SKIPPED','TRIGGERED')
  DO NOTHING;

  PERFORM _assert(
    (SELECT COUNT(*) FROM adherence_events
     WHERE dose_instance_id = v_dose_id AND event_type = 'TAKEN') = 1,
    'Duplicate TAKEN event must be deduplicated'
  );
  RAISE NOTICE '  [PASS] Terminal event deduplication works correctly';
END;
$$;

-- ─── 9. updated_at trigger exists and is attached ───────────────────────────

DO $$
BEGIN
  PERFORM _assert(
    EXISTS (
      SELECT 1 FROM information_schema.triggers
      WHERE event_object_table = 'users'
        AND trigger_name LIKE '%updated_at%'
    ),
    'updated_at trigger must exist on users table'
  );
  PERFORM _assert(
    EXISTS (
      SELECT 1 FROM information_schema.triggers
      WHERE event_object_table = 'medications'
        AND trigger_name LIKE '%updated_at%'
    ),
    'updated_at trigger must exist on medications table'
  );
  RAISE NOTICE '  [PASS] updated_at triggers attached to tables';
END;
$$;

-- ─── 10. Profile version increment ─────────────────────────────────────────

DO $$
DECLARE
  v_user_id UUID := uuid_generate_v7();
  v_v1      INT;
  v_v2      INT;
BEGIN
  INSERT INTO users (id, phone_number) VALUES (v_user_id, '+919999999908');
  INSERT INTO user_adherence_profiles (user_id, adherence_score, risk_level, computed_at)
  VALUES (v_user_id, 0.9, 'LOW', NOW());

  SELECT version INTO v_v1 FROM user_adherence_profiles WHERE user_id = v_user_id;

  UPDATE user_adherence_profiles SET adherence_score = 0.85 WHERE user_id = v_user_id;

  SELECT version INTO v_v2 FROM user_adherence_profiles WHERE user_id = v_user_id;

  PERFORM _assert(v_v2 = v_v1 + 1, 'Profile version must increment by 1 on each UPDATE');
  RAISE NOTICE '  [PASS] Profile version auto-increments on UPDATE';
END;
$$;

-- ─── 11. create_monthly_partitions utility is idempotent ────────────────────

DO $$
BEGIN
  PERFORM create_monthly_partitions('dose_instances', '2026-04-01'::DATE, 1);
  RAISE NOTICE '  [PASS] create_monthly_partitions() is idempotent';
END;
$$;

-- ─── 12. RLS policies exist ─────────────────────────────────────────────────

DO $$
DECLARE
  required_policies TEXT[] := ARRAY[
    'pol_users_self',
    'pol_medications_owner',
    'pol_dose_instances_owner',
    'pol_adherence_events_owner',
    'pol_profiles_owner',
    'pol_followups_owner'
  ];
  p TEXT;
BEGIN
  FOREACH p IN ARRAY required_policies LOOP
    PERFORM _assert(
      EXISTS (SELECT 1 FROM pg_policies WHERE policyname = p),
      format('RLS policy %I must exist', p)
    );
  END LOOP;
  RAISE NOTICE '  [PASS] All RLS policies exist';
END;
$$;

-- ─── Cleanup ────────────────────────────────────────────────────────────────

DROP FUNCTION _assert(BOOLEAN, TEXT);

DO $$ BEGIN RAISE NOTICE ''; END; $$;
DO $$ BEGIN RAISE NOTICE '=== All validations passed. Schema is production-ready. ==='; END; $$;

ROLLBACK;  -- All test data discarded; no permanent changes
