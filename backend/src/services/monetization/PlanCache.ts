import { PlanType, FeatureKey, MetricKey } from './types';
import { getPool } from '../../db/client';
import { logger } from '../../observability/logger';

// =============================================================================
// PlanCache
//
// Two-level cache for plan metadata:
//
//   L1 — process-local in-memory map (no network hop, ~0ms)
//         Holds: feature enablement per plan, usage limits per plan
//         TTL: PLAN_META_TTL_MS (default 5 min, overridable)
//         Invalidated: on write-through from admin API or test setup
//
//   L2 — (future) Redis — drop-in: replace _fetchFromDb() with a Redis GET
//         and promote to L1 on miss.  Interface is already abstracted.
//
// Per-user subscription is NOT cached in the plan cache; it lives in
// SubscriptionService which applies its own TTL map.
// =============================================================================

const PLAN_META_TTL_MS = parseInt(process.env.PLAN_META_TTL_MS ?? '300000', 10); // 5 min

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeatureMatrix = Record<PlanType, Record<FeatureKey, boolean>>;
export type LimitMatrix   = Record<PlanType, Record<MetricKey, number | null>>;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// ─── Module-level singletons (reset in tests via _resetCache) ─────────────────

let _featureEntry: CacheEntry<FeatureMatrix> | null = null;
let _limitEntry:   CacheEntry<LimitMatrix>   | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the full feature matrix (plan → feature → enabled).
 * Hydrates from DB on first call or after TTL expiry.
 */
export async function getFeatureMatrix(): Promise<FeatureMatrix> {
  const now = Date.now();
  if (_featureEntry && _featureEntry.expiresAt > now) {
    return _featureEntry.value;
  }
  const matrix = await _loadFeatureMatrix();
  _featureEntry = { value: matrix, expiresAt: now + PLAN_META_TTL_MS };
  logger.debug({ ttlMs: PLAN_META_TTL_MS }, 'Feature matrix refreshed from DB');
  return matrix;
}

/**
 * Returns the full limit matrix (plan → metric → limit_value|null).
 */
export async function getLimitMatrix(): Promise<LimitMatrix> {
  const now = Date.now();
  if (_limitEntry && _limitEntry.expiresAt > now) {
    return _limitEntry.value;
  }
  const matrix = await _loadLimitMatrix();
  _limitEntry = { value: matrix, expiresAt: now + PLAN_META_TTL_MS };
  logger.debug({ ttlMs: PLAN_META_TTL_MS }, 'Limit matrix refreshed from DB');
  return matrix;
}

/**
 * Force-invalidate both caches.  Call after plan config changes.
 */
export function invalidatePlanCache(): void {
  _featureEntry = null;
  _limitEntry   = null;
  logger.info('Plan cache invalidated');
}

/** Test helper — reset to empty state between test cases. */
export function _resetCache(): void {
  _featureEntry = null;
  _limitEntry   = null;
}

// ─── DB loaders ───────────────────────────────────────────────────────────────

async function _loadFeatureMatrix(): Promise<FeatureMatrix> {
  const { rows } = await getPool().query<{
    plan_type: PlanType;
    feature_key: FeatureKey;
    is_enabled: boolean;
    flag_active: boolean;
  }>(`
    SELECT
      pf.plan_type,
      pf.feature_key,
      pf.is_enabled,
      ff.is_active AS flag_active
    FROM plan_features pf
    JOIN feature_flags ff ON ff.key = pf.feature_key
  `);

  const matrix = _emptyFeatureMatrix();
  for (const row of rows) {
    // A feature is only available when both the flag is globally active
    // AND the plan has it enabled.
    matrix[row.plan_type][row.feature_key] = row.flag_active && row.is_enabled;
  }
  return matrix;
}

async function _loadLimitMatrix(): Promise<LimitMatrix> {
  const { rows } = await getPool().query<{
    plan_type: PlanType;
    metric_key: MetricKey;
    limit_value: number | null;
  }>('SELECT plan_type, metric_key, limit_value FROM usage_limits');

  const matrix = _emptyLimitMatrix();
  for (const row of rows) {
    matrix[row.plan_type][row.metric_key] = row.limit_value;
  }
  return matrix;
}

// ─── Empty matrix factories ───────────────────────────────────────────────────

function _emptyFeatureMatrix(): FeatureMatrix {
  const plans: PlanType[] = ['FREE', 'PREMIUM', 'FAMILY'];
  return Object.fromEntries(
    plans.map((p) => [p, {} as Record<FeatureKey, boolean>]),
  ) as FeatureMatrix;
}

function _emptyLimitMatrix(): LimitMatrix {
  const plans: PlanType[] = ['FREE', 'PREMIUM', 'FAMILY'];
  return Object.fromEntries(
    plans.map((p) => [p, {} as Record<MetricKey, number | null>]),
  ) as LimitMatrix;
}
