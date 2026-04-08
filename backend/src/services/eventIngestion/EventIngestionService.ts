import { PoolClient } from 'pg';
import { withTransaction, getPool } from '../../db/client';
import { AdherenceEventInput } from './validators';
import { ingestionLog } from '../../observability/logger';
import {
  adherenceEventCounter,
  adherenceEventIngestLatency,
} from '../../observability/metrics';

// ─────────────────────────────────────────────────────────────────────────────
// EventIngestionService
//
// Core database operations for adherence event persistence.
//
// Idempotency:
//   Terminal events (TAKEN, MISSED, SKIPPED, TRIGGERED) use a partial unique
//   index on (dose_instance_id, event_type), so ON CONFLICT DO NOTHING silently
//   swallows duplicates.
//
//   SNOOZED events are NOT deduplicated at the DB level (a dose can be snoozed
//   multiple times) — instead, duplicate SNOOZED detection is left to the
//   application layer via snooze_count.
//
// Batch strategy:
//   All events in a batch are inserted inside one transaction. If any individual
//   INSERT fails with a constraint violation other than our dedup conflict, the
//   entire batch is rolled back and the error surfaced.
// ─────────────────────────────────────────────────────────────────────────────

export interface IngestResult {
  inserted: number;
  duplicate: number;
}

const INSERT_SQL = `
  INSERT INTO adherence_events (
    user_id, dose_instance_id, medication_id, event_type,
    scheduled_time_utc, action_time_utc, delay_seconds,
    snooze_count, device_tz, app_version
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  ON CONFLICT (dose_instance_id, event_type)
  WHERE event_type IN ('TAKEN','MISSED','SKIPPED','TRIGGERED')
  DO NOTHING
  RETURNING id
`;

/**
 * Insert a single event using the given pool client.
 * Returns true if the row was inserted, false if it was a duplicate.
 */
async function insertOne(
  client: PoolClient,
  event: AdherenceEventInput,
): Promise<boolean> {
  const { rows } = await client.query<{ id: string }>(INSERT_SQL, [
    event.user_id,
    event.dose_instance_id,
    event.medication_id ?? null,
    event.event_type,
    event.scheduled_time_utc ?? null,
    event.action_time_utc,
    event.delay_seconds ?? null,
    event.snooze_count ?? 0,
    event.device_tz ?? null,
    event.app_version ?? null,
  ]);
  return rows.length > 0;
}

/**
 * Ingest a batch of validated adherence events atomically.
 *
 * Returns counts of inserted vs duplicate rows so the caller can:
 *   • Respond with 200 (partial success is normal for retry/offline uploads)
 *   • Emit metrics
 */
export async function ingestEvents(
  events: AdherenceEventInput[],
): Promise<IngestResult> {
  const startMs = Date.now();
  let inserted = 0;
  let duplicate = 0;

  try {
    await withTransaction(async (client) => {
      for (const event of events) {
        const wasInserted = await insertOne(client, event);
        if (wasInserted) inserted++;
        else duplicate++;
      }
    });

    adherenceEventCounter.inc({ outcome: 'inserted' }, inserted);
    adherenceEventCounter.inc({ outcome: 'duplicate' }, duplicate);

    ingestionLog.info(
      { inserted, duplicate, batchSize: events.length },
      'Batch ingested',
    );

    adherenceEventIngestLatency.observe({ status: 'success' }, Date.now() - startMs);
    return { inserted, duplicate };
  } catch (err) {
    adherenceEventIngestLatency.observe({ status: 'error' }, Date.now() - startMs);
    ingestionLog.error({ err, batchSize: events.length }, 'Batch ingestion failed');
    throw err;
  }
}

/**
 * Fetch the last N events for a user — used in tests and internal debugging.
 */
export async function getRecentEvents(
  userId: string,
  limit = 20,
): Promise<AdherenceEventInput[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM adherence_events
     WHERE user_id = $1
     ORDER BY action_time_utc DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}
