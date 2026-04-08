import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getActiveSubscription } from '../../services/monetization/SubscriptionService';
import { getUserFeatures } from '../../services/monetization/FeatureGateService';
import { getAllUsage, getPlanLimit } from '../../services/monetization/UsageLimitService';
import { getUserPlan } from '../../services/monetization/SubscriptionService';
import { MetricKey } from '../../services/monetization/types';

// =============================================================================
// SubscriptionRouter
//
// GET /v1/users/:user_id/subscription
//   Returns the user's active subscription, feature entitlements, and usage
//   summary in a single response.  Mobile caches this on app launch.
// =============================================================================

const METRICS: MetricKey[] = ['medicines_count', 'caregivers_count', 'followups_count'];

const paramsSchema = z.object({
  user_id: z.string().uuid(),
});

export async function registerSubscriptionRoutes(app: FastifyInstance): Promise<void> {

  app.get(
    '/v1/users/:user_id/subscription',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid user_id' });
      }

      const { user_id } = params.data;

      // All three queries run concurrently
      const [subscription, features, usageRecords, plan] = await Promise.all([
        getActiveSubscription(user_id),
        getUserFeatures(user_id),
        getAllUsage(user_id),
        getUserPlan(user_id),
      ]);

      // Build usage summary with limits side-by-side
      const usageSummary = await Promise.all(
        METRICS.map(async (metric) => {
          const record = usageRecords.find((u) => u.metricKey === metric);
          const limit = await getPlanLimit(user_id, metric);
          return {
            metric,
            current: record?.currentValue ?? 0,
            limit,
          };
        }),
      );

      // Cache hint: mobile should refresh once per day
      reply.header('Cache-Control', 'max-age=3600, private');

      return reply.status(200).send({
        plan_type: plan,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              start_date: subscription.startDate,
              end_date: subscription.endDate,
              provider: subscription.provider,
            }
          : null,
        features,
        usage: usageSummary,
      });
    },
  );
}
