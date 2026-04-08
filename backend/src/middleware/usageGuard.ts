import { FastifyReply } from 'fastify';
import { MetricKey, UsageLimitError } from '../services/monetization/types';
import { assertLimit } from '../services/monetization/UsageLimitService';
import { logger } from '../observability/logger';
import { AuthenticatedRequest } from './featureGuard';

// =============================================================================
// usageGuard  — Fastify preHandler hook factory
//
// Usage — attach per route:
//
//   app.post('/v1/medications', {
//     preHandler: [enforceLimit('medicines_count')],
//   }, handler);
//
// This guard ONLY checks the limit — it does NOT increment the counter.
// Increment is the responsibility of the route handler AFTER the resource
// is successfully created.  This keeps the guard side-effect-free and
// makes rollback trivial.
//
// Typical pattern:
//   preHandler: [enforceLimit('medicines_count')]
//   handler:
//     1. Create the medication in DB
//     2. await incrementUsage(userId, 'medicines_count')
//
// And on DELETE:
//     1. Delete the medication
//     2. await decrementUsage(userId, 'medicines_count')
// =============================================================================

/**
 * Returns a Fastify preHandler that checks (but does not increment) a usage limit.
 *
 * @param metricKey — The usage metric to check before the handler runs.
 */
export function enforceLimit(metricKey: MetricKey) {
  return async function usageGuardHook(
    request: AuthenticatedRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.user?.id ?? (request.params as Record<string, string>)?.user_id;

    if (!userId) {
      return reply.status(401).send({ error: 'Unauthenticated' });
    }

    try {
      await assertLimit(userId, metricKey);
    } catch (err) {
      if (err instanceof UsageLimitError) {
        return reply.status(429).send({
          error: 'Usage limit reached',
          metric: metricKey,
          current: err.currentValue,
          limit: err.limitValue,
          plan: err.planType,
          code: 'USAGE_LIMIT_EXCEEDED',
          upgrade_url: '/v1/billing/plans',
        });
      }
      logger.error({ err, userId, metricKey }, 'Unexpected error in usage guard');
      return reply.status(500).send({ error: 'Internal error checking usage limit' });
    }
  };
}
