import { FastifyRequest, FastifyReply } from 'fastify';
import { FeatureKey, FeatureGateError } from '../services/monetization/types';
import { assertFeatureAccess } from '../services/monetization/FeatureGateService';
import { logger } from '../observability/logger';

// =============================================================================
// featureGuard  — Fastify preHandler hook factory
//
// Usage — attach per route:
//
//   app.post('/v1/caregivers', {
//     preHandler: [requireFeature('caregiver_access')],
//   }, handler);
//
// The user_id must be set on request.user before this hook runs.
// Wire up your auth hook (preHandler) BEFORE feature guards in the chain.
//
// Behaviour:
//   • Calls assertFeatureAccess; on FeatureGateError → 403 with upgrade hint
//   • On any other error → 500 (fail open for reminders; fail closed here
//     because non-reminder features are safe to block on error)
// =============================================================================

export interface AuthenticatedRequest extends FastifyRequest {
  user?: { id: string; phone: string };
}

/**
 * Returns a Fastify preHandler that enforces feature access for the given key.
 *
 * @param featureKey  — The feature that must be enabled on the user's plan.
 */
export function requireFeature(featureKey: FeatureKey) {
  return async function featureGuardHook(
    request: AuthenticatedRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.user?.id ?? (request.params as Record<string, string>)?.user_id;

    if (!userId) {
      return reply.status(401).send({ error: 'Unauthenticated' });
    }

    try {
      await assertFeatureAccess(userId, featureKey);
      // assertFeatureAccess throws if denied; if it returns, access is granted
    } catch (err) {
      if (err instanceof FeatureGateError) {
        return reply.status(403).send({
          error: 'Feature not available on your plan',
          feature: featureKey,
          code: 'FEATURE_GATED',
          upgrade_url: '/v1/billing/plans',
        });
      }
      logger.error({ err, userId, featureKey }, 'Unexpected error in feature guard');
      return reply.status(500).send({ error: 'Internal error checking feature access' });
    }
  };
}
