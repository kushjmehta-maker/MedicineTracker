import { getPool, withTransaction } from '../../db/client';
import {
  Subscription,
  PlanType,
  SubscriptionStatus,
  WebhookEvent,
  BillingProvider,
} from './types';
import { logger } from '../../observability/logger';

// =============================================================================
// SubscriptionService
//
// Single source of truth for a user's current plan.
//
// Cache strategy:
//   Per-user TTL map (process-local, 5–15 min configurable).
//   On any mutation (handleSubscriptionUpdate) the user's entry is evicted.
//   On cache miss → DB read.  If DB is unavailable → safe FREE fallback.
//
// Safety invariant:
//   NEVER block reminders.  If we can't determine the plan, return FREE.
//   This prevents a billing outage from killing medication reminders.
// =============================================================================

const USER_PLAN_TTL_MS = parseInt(process.env.USER_PLAN_TTL_MS ?? '600000', 10); // 10 min

interface CacheEntry {
  planType: PlanType;
  expiresAt: number;
}

// Module-level per-user cache (reset in tests via _resetSubscriptionCache)
const _cache = new Map<string, CacheEntry>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the user's current effective plan type.
 * Falls back to FREE on any error (billing outage safety net).
 */
export async function getUserPlan(userId: string): Promise<PlanType> {
  const cached = _getCached(userId);
  if (cached) return cached;

  try {
    const sub = await getActiveSubscription(userId);
    const plan: PlanType = sub ? sub.planType : 'FREE';
    _setCached(userId, plan);
    return plan;
  } catch (err) {
    logger.warn({ err, userId }, 'getUserPlan DB error — defaulting to FREE (safety fallback)');
    return 'FREE';  // Never block reminders due to billing outage
  }
}

/**
 * Returns true if the user has an active PREMIUM or FAMILY subscription.
 */
export async function isPremium(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId);
  return plan === 'PREMIUM' || plan === 'FAMILY';
}

/**
 * Returns the raw active Subscription row or null if the user is on FREE.
 * Applies grace period logic before returning.
 */
export async function getActiveSubscription(userId: string): Promise<Subscription | null> {
  const { rows } = await getPool().query<{
    id: string;
    user_id: string;
    plan_type: PlanType;
    status: SubscriptionStatus;
    start_date: Date;
    end_date: Date | null;
    provider: BillingProvider | null;
    provider_subscription_id: string | null;
    grace_period_minutes: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, user_id, plan_type, status, start_date, end_date,
            provider, provider_subscription_id, grace_period_minutes,
            created_at, updated_at
     FROM subscriptions
     WHERE user_id = $1
       AND status IN ('ACTIVE','TRIAL')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;
  const row = rows[0];

  // Apply grace period: if end_date has passed but we're still in the grace window,
  // treat the subscription as still active.
  if (row.end_date) {
    const graceDeadline = new Date(
      row.end_date.getTime() + row.grace_period_minutes * 60_000,
    );
    if (new Date() > graceDeadline) {
      // Grace window expired — expire the row and return null
      await _expireSubscription(row.id);
      _evict(userId);
      return null;
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    planType: row.plan_type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    provider: row.provider,
    providerSubscriptionId: row.provider_subscription_id,
    gracePeriodMinutes: row.grace_period_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Process a billing provider webhook event.  Idempotent — replaying
 * the same provider_subscription_id + eventType is safe.
 */
export async function handleSubscriptionUpdate(event: WebhookEvent): Promise<void> {
  logger.info({ event }, 'Processing subscription webhook event');

  await withTransaction(async (client) => {
    // Find the subscription row for this provider ID
    const { rows } = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM subscriptions
       WHERE provider = $1 AND provider_subscription_id = $2
       LIMIT 1`,
      [event.provider, event.providerSubscriptionId],
    );

    if (rows.length === 0) {
      // No existing row — this is a new purchase.
      // We need a user_id; for new purchases the mobile client must call
      // POST /v1/billing/receipt/verify first which creates the row.
      logger.warn(
        { event },
        'Webhook received for unknown provider_subscription_id — skipping (receipt verify must come first)',
      );
      return;
    }

    const { id: subscriptionId, user_id: userId } = rows[0];
    const newStatus = _eventTypeToStatus(event.eventType);

    await client.query(
      `UPDATE subscriptions
       SET status = $1, end_date = $2, plan_type = $3, updated_at = NOW()
       WHERE id = $4`,
      [newStatus, event.endDate ?? null, event.planType, subscriptionId],
    );

    // Evict cache so next request gets fresh data
    _evict(userId);

    logger.info({ subscriptionId, userId, newStatus }, 'Subscription updated via webhook');
  });
}

/**
 * Create or update a subscription from a verified receipt.
 * Used by POST /v1/billing/receipt/verify after server-side receipt validation.
 */
export async function upsertSubscription(params: {
  userId: string;
  planType: PlanType;
  status: SubscriptionStatus;
  provider: BillingProvider;
  providerSubscriptionId: string;
  startDate: Date;
  endDate: Date | null;
}): Promise<Subscription> {
  await getPool().query<{ id: string }>(
    `INSERT INTO subscriptions
       (user_id, plan_type, status, provider, provider_subscription_id, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (provider, provider_subscription_id)
     WHERE provider_subscription_id IS NOT NULL
     DO UPDATE SET
       status    = EXCLUDED.status,
       plan_type = EXCLUDED.plan_type,
       end_date  = EXCLUDED.end_date,
       updated_at = NOW()
     RETURNING id`,
    [
      params.userId,
      params.planType,
      params.status,
      params.provider,
      params.providerSubscriptionId,
      params.startDate.toISOString(),
      params.endDate?.toISOString() ?? null,
    ],
  );

  _evict(params.userId);

  const sub = await getActiveSubscription(params.userId);
  if (!sub) throw new Error('Subscription upsert succeeded but active row not found');
  return sub;
}

/**
 * Sweep subscriptions whose grace window has expired and mark them EXPIRED.
 * Called by a nightly cron.
 */
export async function expireStaleSubscriptions(): Promise<number> {
  const { rowCount } = await getPool().query(`
    UPDATE subscriptions
    SET status = 'EXPIRED', updated_at = NOW()
    WHERE status IN ('ACTIVE','TRIAL')
      AND end_date IS NOT NULL
      AND end_date + (grace_period_minutes * INTERVAL '1 minute') < NOW()
  `);

  const count = rowCount ?? 0;
  if (count > 0) {
    logger.info({ count }, 'Expired stale subscriptions');
    // Mass-evict the whole cache — we don't know which users were affected
    _cache.clear();
  }
  return count;
}

/** Test helper. */
export function _resetSubscriptionCache(): void {
  _cache.clear();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _getCached(userId: string): PlanType | null {
  const entry = _cache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _cache.delete(userId);
    return null;
  }
  return entry.planType;
}

function _setCached(userId: string, planType: PlanType): void {
  _cache.set(userId, { planType, expiresAt: Date.now() + USER_PLAN_TTL_MS });
}

function _evict(userId: string): void {
  _cache.delete(userId);
}

function _eventTypeToStatus(eventType: WebhookEvent['eventType']): SubscriptionStatus {
  switch (eventType) {
    case 'PURCHASED':
    case 'RENEWED':
      return 'ACTIVE';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
    case 'REFUNDED':
      return 'EXPIRED';
  }
}

async function _expireSubscription(subscriptionId: string): Promise<void> {
  await getPool().query(
    `UPDATE subscriptions SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
    [subscriptionId],
  );
}
