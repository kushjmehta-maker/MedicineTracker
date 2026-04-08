import { getPool } from '../../db/client';
import { logger } from '../../observability/logger';

// =============================================================================
// UserSyncService
//
// Maps a Firebase UID to an internal users.id (UUID v7).
// On first login the user row is created; subsequent logins hit the cache.
//
// Why a separate mapping table?
//   Firebase UIDs are opaque strings like "abc123XYZ".  Our internal IDs are
//   UUID v7 (time-sortable).  Keeping them separate lets us swap auth providers
//   (or support multiple providers per user) without schema migrations.
// =============================================================================

// Process-local cache: firebase_uid → internal user_id
// TTL is indefinite — UIDs don't change; evict only on error.
const _uidCache = new Map<string, string>();

export interface InternalUser {
  id: string;       // UUID v7 — our primary key
  phone: string;
  firebaseUid: string;
}

/**
 * Given a verified Firebase UID and phone number, return (creating if needed)
 * the corresponding internal user record.
 *
 * Idempotent: calling this multiple times with the same UID is safe.
 */
export async function syncUser(firebaseUid: string, phone: string): Promise<InternalUser> {
  // L1 cache hit
  const cached = _uidCache.get(firebaseUid);
  if (cached) {
    return { id: cached, phone, firebaseUid };
  }

  // Try to find existing mapping
  const { rows: existing } = await getPool().query<{ user_id: string; phone_number: string }>(
    `SELECT u.id AS user_id, u.phone_number
     FROM users u
     JOIN firebase_uid_map m ON m.user_id = u.id
     WHERE m.firebase_uid = $1`,
    [firebaseUid],
  );

  if (existing.length > 0) {
    const userId = existing[0].user_id;
    _uidCache.set(firebaseUid, userId);
    return { id: userId, phone: existing[0].phone_number, firebaseUid };
  }

  // New user — create atomically
  const { rows: created } = await getPool().query<{ id: string }>(
    `WITH new_user AS (
       INSERT INTO users (phone_number)
       VALUES ($1)
       ON CONFLICT (phone_number) WHERE deleted_at IS NULL
       DO UPDATE SET updated_at = NOW()
       RETURNING id
     )
     INSERT INTO firebase_uid_map (firebase_uid, user_id)
     SELECT $2, id FROM new_user
     ON CONFLICT (firebase_uid) DO NOTHING
     RETURNING user_id AS id`,
    [phone, firebaseUid],
  );

  // Handle race: another request may have created the user first
  if (created.length === 0) {
    const { rows: retry } = await getPool().query<{ user_id: string }>(
      `SELECT user_id FROM firebase_uid_map WHERE firebase_uid = $1`,
      [firebaseUid],
    );
    if (retry.length === 0) throw new Error(`Failed to sync user for Firebase UID ${firebaseUid}`);
    _uidCache.set(firebaseUid, retry[0].user_id);
    return { id: retry[0].user_id, phone, firebaseUid };
  }

  const userId = created[0].id;
  _uidCache.set(firebaseUid, userId);
  logger.info({ userId, phone }, 'New user created via Firebase auth');
  return { id: userId, phone, firebaseUid };
}

/** Evict a single UID from the process cache (e.g. after account deletion). */
export function evictFromCache(firebaseUid: string): void {
  _uidCache.delete(firebaseUid);
}
