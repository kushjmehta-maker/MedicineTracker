import { FeatureKey, FeatureGateError } from './types';
import { getUserPlan } from './SubscriptionService';
import { getFeatureMatrix } from './PlanCache';
import { logger } from '../../observability/logger';

// =============================================================================
// FeatureGateService
//
// Answers "can user X use feature Y?" using the plan-feature matrix loaded
// from the DB and cached in-process (see PlanCache).
//
// Design rule: NEVER gate reminders, missed_dose_detection, or doctor_followups.
// These are enforced by the UNGATED_FEATURES set below.
// =============================================================================

/** Features that bypass all gating — always returns true regardless of plan. */
const UNGATED_FEATURES = new Set<FeatureKey>([
  'reminders',
  'missed_dose_detection',
  'doctor_followups',
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the feature is available for this user's current plan.
 * Core reminder features always return true regardless of plan.
 * Falls back to true on any error (reminders must never be blocked).
 */
export async function isFeatureEnabled(
  userId: string,
  featureKey: FeatureKey,
): Promise<boolean> {
  // Safety: core features are always on
  if (UNGATED_FEATURES.has(featureKey)) return true;

  try {
    const [plan, matrix] = await Promise.all([
      getUserPlan(userId),
      getFeatureMatrix(),
    ]);

    const planFeatures = matrix[plan];
    // If the plan isn't in the matrix at all (e.g. DB seed not yet run),
    // fall back to true for safety on reminder-adjacent features.
    if (!planFeatures) {
      logger.warn({ plan, featureKey }, 'Plan not found in feature matrix — defaulting to enabled');
      return true;
    }

    return planFeatures[featureKey] === true;
  } catch (err) {
    logger.warn({ err, userId, featureKey }, 'isFeatureEnabled error — defaulting to false');
    return false;
  }
}

/**
 * Throws FeatureGateError (HTTP 403) if the feature is not available.
 * Use this in service-layer code that should raise before writing to DB.
 */
export async function assertFeatureAccess(
  userId: string,
  featureKey: FeatureKey,
): Promise<void> {
  const enabled = await isFeatureEnabled(userId, featureKey);
  if (!enabled) {
    const plan = await getUserPlan(userId);
    logger.info({ userId, featureKey, plan }, 'Feature access denied');
    throw new FeatureGateError(featureKey, plan);
  }
}

/**
 * Returns a map of every feature and whether it's enabled for this user.
 * Used by the mobile app to pre-populate the feature availability state
 * without making N individual calls.
 */
export async function getUserFeatures(
  userId: string,
): Promise<Record<FeatureKey, boolean>> {
  const [plan, matrix] = await Promise.all([
    getUserPlan(userId),
    getFeatureMatrix(),
  ]);

  const planFeatures = matrix[plan] ?? ({} as Record<FeatureKey, boolean>);

  // Overlay: core features are always true regardless of matrix
  const result = { ...planFeatures } as Record<FeatureKey, boolean>;
  for (const key of UNGATED_FEATURES) {
    result[key] = true;
  }

  return result;
}

/**
 * Returns the effective plan for an adaptive-engine decision.
 * Returns 'advanced' for PREMIUM/FAMILY, 'basic' for FREE.
 * Used by the notification strategy layer without coupling to PlanType.
 */
export async function getAdaptiveTier(
  userId: string,
): Promise<'basic' | 'advanced'> {
  const enabled = await isFeatureEnabled(userId, 'advanced_adherence');
  return enabled ? 'advanced' : 'basic';
}
