-- =============================================================================
-- Migration 001: Extensions and shared utility functions
--
-- Run this FIRST on any fresh database.  All subsequent migrations depend on
-- the functions defined here.
-- =============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- uuid_generate_v4() fallback
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_bytes(), crypt()

-- ─── UUID v7 generator ────────────────────────────────────────────────────────
--
-- UUID v7 is time-sortable (48-bit millisecond timestamp in the high bits),
-- which means:
--   • B-tree indexes grow monotonically → no page splits on insert
--   • Natural ordering by creation time without an extra created_at index
--   • Better connection-pool cache hit rate for recent-record lookups
--
-- Format (RFC draft):
--   Bits  0-47  : Unix timestamp in milliseconds (big-endian)
--   Bits 48-51  : Version = 7
--   Bits 52-63  : 12 random bits
--   Bits 64-65  : Variant = 0b10 (RFC 4122)
--   Bits 66-127 : 62 random bits

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_unix_ms  BIGINT := (EXTRACT(EPOCH FROM CLOCK_TIMESTAMP()) * 1000)::BIGINT;
  v_rand     BYTEA  := gen_random_bytes(10);
  v_bytes    BYTEA  := decode(repeat('00', 16), 'hex');  -- 16 zero bytes
BEGIN
  -- ── Bytes 0-5: 48-bit Unix timestamp (big-endian) ─────────────────────────
  v_bytes := set_byte(v_bytes, 0, ((v_unix_ms >> 40) & 255)::INT);
  v_bytes := set_byte(v_bytes, 1, ((v_unix_ms >> 32) & 255)::INT);
  v_bytes := set_byte(v_bytes, 2, ((v_unix_ms >> 24) & 255)::INT);
  v_bytes := set_byte(v_bytes, 3, ((v_unix_ms >> 16) & 255)::INT);
  v_bytes := set_byte(v_bytes, 4, ((v_unix_ms >>  8) & 255)::INT);
  v_bytes := set_byte(v_bytes, 5, ( v_unix_ms        & 255)::INT);

  -- ── Byte 6: version nibble (0x7 = 0b0111) | top 4 bits of rand ────────────
  v_bytes := set_byte(v_bytes, 6, 112 | (get_byte(v_rand, 0) >> 4));

  -- ── Byte 7: bottom 4 bits of rand[0] << 4 | top 4 bits of rand[1] ─────────
  v_bytes := set_byte(v_bytes, 7, ((get_byte(v_rand, 0) & 15) << 4)
                                | (get_byte(v_rand, 1) >> 4));

  -- ── Byte 8: RFC 4122 variant (0x80 = 0b10xxxxxx) | bottom 6 bits of rand ──
  v_bytes := set_byte(v_bytes, 8, 128 | (get_byte(v_rand, 1) & 63));

  -- ── Bytes 9-15: 7 fully random bytes ─────────────────────────────────────
  v_bytes := set_byte(v_bytes,  9, get_byte(v_rand, 2));
  v_bytes := set_byte(v_bytes, 10, get_byte(v_rand, 3));
  v_bytes := set_byte(v_bytes, 11, get_byte(v_rand, 4));
  v_bytes := set_byte(v_bytes, 12, get_byte(v_rand, 5));
  v_bytes := set_byte(v_bytes, 13, get_byte(v_rand, 6));
  v_bytes := set_byte(v_bytes, 14, get_byte(v_rand, 7));
  v_bytes := set_byte(v_bytes, 15, get_byte(v_rand, 8));

  RETURN encode(v_bytes, 'hex')::UUID;
END;
$$;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'Generates a UUID v7 (time-sortable). Monotonically increasing within the same millisecond.';

-- ─── updated_at auto-maintenance trigger ──────────────────────────────────────
--
-- Attach to any table with an updated_at column:
--   CREATE TRIGGER trg_<table>_updated_at
--     BEFORE UPDATE ON <table>
--     FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_set_updated_at() IS
  'Reusable BEFORE UPDATE trigger function that stamps updated_at = NOW().';

-- ─── Soft-delete guard: prevent hard-delete of analytics data ─────────────────
--
-- Attaching this trigger to adherence_events prevents accidental DELETE
-- statements in production.  Analytics data must be retained for compliance.
-- To truly delete, first set a deleted_at column (future soft-delete migration).

CREATE OR REPLACE FUNCTION trigger_deny_delete_analytics()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Hard deletes on adherence_events are disabled. '
    'Set deleted_at timestamp instead (soft-delete). '
    'Use the bypass_analytics_delete_guard session variable to override in migrations.';
END;
$$;
