import { Pool } from 'pg';
import { getPool } from '../../db/client';

// ─────────────────────────────────────────────────────────────────────────────
// AdherenceComputationService
//
// Pure computation logic — all side effects (DB writes, metrics) live in the
// cron job wrapper so these functions are unit-testable with injected data.
//
// Computation window: rolling 7 days (primary), 30 days (counts only)
//
// For each user:
//   taken_on_time  = TAKEN where delay_seconds <= 300
//   total_sched    = count(TRIGGERED)
//   adherence_rate = taken_on_time / total_sched  (1.0 if no TRIGGERED events)
//   avg_delay_min  = avg(delay_seconds for TAKEN) / 60
//   snooze_rate    = count(SNOOZED) / total_sched
//   miss_rate      = count(MISSED) / total_sched
//   consistency    = max(0, 1 - stddev_delay_seconds / 1800)
//                    (normalised on a 30-minute std-dev scale)
// ─────────────────────────────────────────────────────────────────────────────

/** Raw DB row from the per-user aggregation query */
interface RawUserMetrics {
  user_id: string;
  total_scheduled: string;    // BIGINT → string in node-postgres
  taken_on_time: string;
  total_taken: string;
  avg_delay_seconds: string | null;
  total_snoozed: string;
  total_missed: string;
  stddev_delay_seconds: string | null;
  last_30d_taken: string;
  last_30d_scheduled: string;
}

export interface ComputedProfile {
  userId: string;
  adherenceScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  adherenceRate: number;
  avgDelayMinutes: number;
  snoozeRate: number;
  missRate: number;
  consistencyScore: number;
  last7dTaken: number;
  last7dScheduled: number;
  last30dTaken: number;
  last30dScheduled: number;
}

// ─── Pure computation functions (testable without DB) ─────────────────────────

export function computeConsistencyScore(stddevDelaySeconds: number | null): number {
  if (stddevDelaySeconds === null || stddevDelaySeconds === 0) return 1.0;
  // Normalise on a 30-minute (1800s) scale — std dev ≥ 30 min → score = 0
  return Math.max(0, 1 - stddevDelaySeconds / 1800);
}

export function computeAdherenceScore(metrics: {
  adherenceRate: number;
  avgDelayMinutes: number;
  snoozeRate: number;
  consistencyScore: number;
}): number {
  // Formula specified in PRD — do not change coefficients
  const delayScore = Math.max(0, 1 - metrics.avgDelayMinutes / 60);
  const snoozeScore = Math.max(0, 1 - metrics.snoozeRate);

  const score =
    0.5 * metrics.adherenceRate +
    0.2 * delayScore +
    0.2 * snoozeScore +
    0.1 * metrics.consistencyScore;

  // Clamp to [0, 1] to guard against floating-point edge cases
  return Math.min(1, Math.max(0, score));
}

export function classifyRisk(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 0.85) return 'LOW';
  if (score >= 0.60) return 'MEDIUM';
  return 'HIGH';
}

export function buildProfile(raw: RawUserMetrics): ComputedProfile {
  const totalScheduled = parseInt(raw.total_scheduled, 10) || 0;
  const takenOnTime = parseInt(raw.taken_on_time, 10) || 0;
  const totalTaken = parseInt(raw.total_taken, 10) || 0;
  const totalSnoozed = parseInt(raw.total_snoozed, 10) || 0;
  const totalMissed = parseInt(raw.total_missed, 10) || 0;

  const adherenceRate = totalScheduled > 0 ? takenOnTime / totalScheduled : 1.0;
  const avgDelaySeconds = raw.avg_delay_seconds ? parseFloat(raw.avg_delay_seconds) : 0;
  const avgDelayMinutes = avgDelaySeconds / 60;
  const snoozeRate = totalScheduled > 0 ? totalSnoozed / totalScheduled : 0;
  const missRate = totalScheduled > 0 ? totalMissed / totalScheduled : 0;
  const stddevDelay = raw.stddev_delay_seconds ? parseFloat(raw.stddev_delay_seconds) : null;
  const consistencyScore = computeConsistencyScore(stddevDelay);

  const adherenceScore = computeAdherenceScore({
    adherenceRate,
    avgDelayMinutes,
    snoozeRate,
    consistencyScore,
  });

  return {
    userId: raw.user_id,
    adherenceScore,
    riskLevel: classifyRisk(adherenceScore),
    adherenceRate,
    avgDelayMinutes,
    snoozeRate,
    missRate,
    consistencyScore,
    last7dTaken: totalTaken,
    last7dScheduled: totalScheduled,
    last30dTaken: parseInt(raw.last_30d_taken, 10) || 0,
    last30dScheduled: parseInt(raw.last_30d_scheduled, 10) || 0,
  };
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const METRICS_7D_SQL = `
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE event_type = 'TRIGGERED')                                          AS total_scheduled,
    COUNT(*) FILTER (WHERE event_type = 'TAKEN' AND delay_seconds <= 300)                     AS taken_on_time,
    COUNT(*) FILTER (WHERE event_type = 'TAKEN')                                              AS total_taken,
    AVG(delay_seconds) FILTER (WHERE event_type = 'TAKEN')                                    AS avg_delay_seconds,
    COUNT(*) FILTER (WHERE event_type = 'SNOOZED')                                            AS total_snoozed,
    COUNT(*) FILTER (WHERE event_type = 'MISSED')                                             AS total_missed,
    STDDEV(delay_seconds::float) FILTER (WHERE event_type = 'TAKEN' AND delay_seconds IS NOT NULL) AS stddev_delay_seconds
  FROM adherence_events
  WHERE user_id = ANY($1)
    AND action_time_utc >= NOW() - INTERVAL '7 days'
  GROUP BY user_id
`;

const COUNTS_30D_SQL = `
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE event_type = 'TAKEN')     AS last_30d_taken,
    COUNT(*) FILTER (WHERE event_type = 'TRIGGERED') AS last_30d_scheduled
  FROM adherence_events
  WHERE user_id = ANY($1)
    AND action_time_utc >= NOW() - INTERVAL '30 days'
  GROUP BY user_id
`;

const UPSERT_PROFILE_SQL = `
  INSERT INTO user_adherence_profiles (
    user_id, adherence_score, risk_level,
    adherence_rate, avg_delay_minutes, snooze_rate, miss_rate, consistency_score,
    last_7d_taken, last_7d_scheduled, last_30d_taken, last_30d_scheduled,
    computed_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    adherence_score   = EXCLUDED.adherence_score,
    risk_level        = EXCLUDED.risk_level,
    adherence_rate    = EXCLUDED.adherence_rate,
    avg_delay_minutes = EXCLUDED.avg_delay_minutes,
    snooze_rate       = EXCLUDED.snooze_rate,
    miss_rate         = EXCLUDED.miss_rate,
    consistency_score = EXCLUDED.consistency_score,
    last_7d_taken     = EXCLUDED.last_7d_taken,
    last_7d_scheduled = EXCLUDED.last_7d_scheduled,
    last_30d_taken    = EXCLUDED.last_30d_taken,
    last_30d_scheduled= EXCLUDED.last_30d_scheduled,
    computed_at       = EXCLUDED.computed_at
`;

// ─── DB-backed computation (called by cron) ───────────────────────────────────

/**
 * Compute and persist profiles for a specific batch of user IDs.
 * Returns the number of profiles written.
 */
export async function computeAndPersistBatch(
  userIds: string[],
  pool?: Pool,
): Promise<number> {
  const db = pool ?? getPool();

  // Fetch 7d and 30d metrics in parallel
  const [result7d, result30d] = await Promise.all([
    db.query<RawUserMetrics>(METRICS_7D_SQL, [userIds]),
    db.query<{ user_id: string; last_30d_taken: string; last_30d_scheduled: string }>(
      COUNTS_30D_SQL,
      [userIds],
    ),
  ]);

  // Build lookup map for 30d counts
  const counts30d = new Map(result30d.rows.map((r) => [r.user_id, r]));

  const profiles: ComputedProfile[] = [];
  for (const row of result7d.rows) {
    const thirtyDay = counts30d.get(row.user_id);
    const merged: RawUserMetrics = {
      ...row,
      last_30d_taken: thirtyDay?.last_30d_taken ?? '0',
      last_30d_scheduled: thirtyDay?.last_30d_scheduled ?? '0',
    };
    profiles.push(buildProfile(merged));
  }

  // Users who had no events in the 7d window still need a profile reset
  // (they appear only in counts30d or not at all)
  for (const userId of userIds) {
    if (!result7d.rows.find((r) => r.user_id === userId)) {
      const thirtyDay = counts30d.get(userId);
      profiles.push(
        buildProfile({
          user_id: userId,
          total_scheduled: '0',
          taken_on_time: '0',
          total_taken: '0',
          avg_delay_seconds: null,
          total_snoozed: '0',
          total_missed: '0',
          stddev_delay_seconds: null,
          last_30d_taken: thirtyDay?.last_30d_taken ?? '0',
          last_30d_scheduled: thirtyDay?.last_30d_scheduled ?? '0',
        }),
      );
    }
  }

  // Persist all profiles
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const p of profiles) {
      await client.query(UPSERT_PROFILE_SQL, [
        p.userId,
        p.adherenceScore,
        p.riskLevel,
        p.adherenceRate,
        p.avgDelayMinutes,
        p.snoozeRate,
        p.missRate,
        p.consistencyScore,
        p.last7dTaken,
        p.last7dScheduled,
        p.last30dTaken,
        p.last30dScheduled,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return profiles.length;
}

/**
 * Get distinct user IDs with events in the last 30 days using cursor-based
 * pagination.  Used by the cron job to iterate through up to 500k users
 * without loading them all into memory.
 */
export async function* iterateActiveUserIdBatches(
  batchSize: number,
  pool?: Pool,
): AsyncGenerator<string[]> {
  const db = pool ?? getPool();
  let cursor = '00000000-0000-0000-0000-000000000000';

  while (true) {
    const { rows } = await db.query<{ user_id: string }>(
      `SELECT DISTINCT user_id
       FROM adherence_events
       WHERE action_time_utc >= NOW() - INTERVAL '30 days'
         AND user_id > $1
       ORDER BY user_id
       LIMIT $2`,
      [cursor, batchSize],
    );

    if (rows.length === 0) break;

    yield rows.map((r) => r.user_id);
    cursor = rows[rows.length - 1].user_id;
  }
}
