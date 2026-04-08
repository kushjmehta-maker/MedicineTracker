import { getPool } from '../../db/client';
import { MetricKey, UsageRecord, UsageLimitError } from './types';
import { getUserPlan } from './SubscriptionService';
import { getLimitMatrix } from './PlanCache';
import { logger } from '../../observability/logger';

// =============================================================================
// UsageLimitService
//
// Manages per-user resource counters and enforces plan limits.
//
// Atomicity guarantee:
//   incrementUsage uses INSERT ... ON CONFLICT DO UPDATE with an explicit
//   check to prevent the counter exceeding the plan limit in a race.
//   If two concurrent requests both pass checkLimit, only one will succeed
//   the atomic increment; the other gets a serialization-safe 0-row update
//   that is detected and raises UsageLimitError.
//
// Decrement:
//   Call decrementUsage when a resource is deleted (medicine removed, etc.)
//   The counter is floored at 0 to guard against double-decrements.
// =============================================================================

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the user's current usage for a metric.
 * Returns 0 if no row exists (user hasn't created any resources yet).
 */
export async function getUsage(userId: string, metricKey: MetricKey): Promise<number> {
  const { rows } = await getPool().query<{ current_value: number }>(
    `SELECT current_value
     FROM usage_tracking
     WHERE user_id = $1 AND metric_key = $2`,
    [userId, metricKey],
  );
  return rows[0]?.current_value ?? 0;
}

/**
 * Returns the plan limit for a metric (null = unlimited).
 */
export async function getPlanLimit(
  userId: string,
  metricKey: MetricKey,
): Promise<number | null> {
  const [plan, matrix] = await Promise.all([getUserPlan(userId), getLimitMatrix()]);
  return matrix[plan]?.[metricKey] ?? null;
}

/**
 * Returns true if the user is within their plan limit (or has no limit).
 */
export async function checkLimit(userId: string, metricKey: MetricKey): Promise<boolean> {
  const [current, limit] = await Promise.all([
    getUsage(userId, metricKey),
    getPlanLimit(userId, metricKey),
  ]);
  if (limit === null) return true;
  return current < limit;
}

/**
 * Throws UsageLimitError (HTTP 429) if the user is at their limit.
 */
export async function assertLimit(userId: string, metricKey: MetricKey): Promise<void> {
  const [current, limit] = await Promise.all([
    getUsage(userId, metricKey),
    getPlanLimit(userId, metricKey),
  ]);

  if (limit !== null && current >= limit) {
    const plan = await getUserPlan(userId);
    logger.info({ userId, metricKey, current, limit, plan }, 'Usage limit reached');
    throw new UsageLimitError(metricKey, current, limit, plan);
  }
}

/**
 * Atomically increments the usage counter by 1.
 *
 * Race-safe: the UPDATE inside the ON CONFLICT clause includes a WHERE
 * clause that prevents incrementing past the plan limit.  If the increment
 * is blocked (returns 0 updated rows), we throw UsageLimitError.
 */
export async function incrementUsage(userId: string, metricKey: MetricKey): Promise<number> {
  const limit = await getPlanLimit(userId, metricKey);

  // Build the conditional increment SQL.
  // If limit is null (unlimited), skip the upper-bound check.
  const limitClause =
    limit !== null
      ? `AND usage_tracking.current_value < ${limit}`
      : '';

  const { rows } = await getPool().query<{ current_value: number }>(
    `INSERT INTO usage_tracking (user_id, metric_key, current_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, metric_key) DO UPDATE
       SET current_value = usage_tracking.current_value + 1,
           updated_at    = NOW()
       WHERE TRUE ${limitClause}
     RETURNING current_value`,
    [userId, metricKey],
  );

  if (rows.length === 0) {
    // The WHERE clause blocked the increment — user is at their limit.
    const current = await getUsage(userId, metricKey);
    const plan = await getUserPlan(userId);
    throw new UsageLimitError(metricKey, current, limit!, plan);
  }

  logger.debug(
    { userId, metricKey, newValue: rows[0].current_value },
    'Usage incremented',
  );
  return rows[0].current_value;
}

/**
 * Decrements the usage counter by 1, floored at 0.
 * Call when a resource is deleted (medicine removed, caregiver removed, etc.)
 */
export async function decrementUsage(userId: string, metricKey: MetricKey): Promise<number> {
  const { rows } = await getPool().query<{ current_value: number }>(
    `INSERT INTO usage_tracking (user_id, metric_key, current_value)
     VALUES ($1, $2, 0)
     ON CONFLICT (user_id, metric_key) DO UPDATE
       SET current_value = GREATEST(usage_tracking.current_value - 1, 0),
           updated_at    = NOW()
     RETURNING current_value`,
    [userId, metricKey],
  );
  logger.debug(
    { userId, metricKey, newValue: rows[0]?.current_value ?? 0 },
    'Usage decremented',
  );
  return rows[0]?.current_value ?? 0;
}

/**
 * Reset a user's usage counter to 0.
 * Use when a user upgrades to PREMIUM or when their data is wiped.
 */
export async function resetUsage(userId: string, metricKey: MetricKey): Promise<void> {
  await getPool().query(
    `INSERT INTO usage_tracking (user_id, metric_key, current_value)
     VALUES ($1, $2, 0)
     ON CONFLICT (user_id, metric_key) DO UPDATE
       SET current_value = 0, updated_at = NOW()`,
    [userId, metricKey],
  );
}

/**
 * Get all usage records for a user.  Used by the mobile app to show a
 * usage summary ("3/10 medicines used").
 */
export async function getAllUsage(userId: string): Promise<UsageRecord[]> {
  const { rows } = await getPool().query<{
    user_id: string;
    metric_key: MetricKey;
    current_value: number;
    updated_at: Date;
  }>(
    `SELECT user_id, metric_key, current_value, updated_at
     FROM usage_tracking
     WHERE user_id = $1`,
    [userId],
  );

  return rows.map((r) => ({
    userId: r.user_id,
    metricKey: r.metric_key,
    currentValue: r.current_value,
    updatedAt: r.updated_at,
  }));
}
