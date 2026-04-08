import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getStrategyForUser } from './NotificationStrategyService';
import { strategyLog } from '../../observability/logger';
import { strategyFetchLatency } from '../../observability/metrics';

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/users/:user_id/notification-strategy
//
// Low-latency endpoint — profile is precomputed nightly; this is just a DB
// read.  Target: < 100ms P95.
//
// Cache headers:
//   Cache-Control: max-age=86400  →  mobile caches for 24h
//   ETag not implemented in MVP (profile version tracking is future work)
// ─────────────────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  user_id: z.string().uuid({ message: 'user_id must be a valid UUID' }),
});

export async function registerNotificationStrategyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/users/:user_id/notification-strategy',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const startMs = Date.now();
      let riskLevel = 'UNKNOWN';

      // ── 1. Validate path param ────────────────────────────────────────────
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          error: 'Invalid user_id',
          details: params.error.flatten().fieldErrors,
        });
      }

      const { user_id } = params.data;

      // ── 2. Fetch strategy ─────────────────────────────────────────────────
      const strategyResponse = await getStrategyForUser(user_id);
      riskLevel = strategyResponse.riskLevel;

      // ── 3. Cache headers ─────────────────────────────────────────────────
      const cacheTtl = parseInt(process.env.STRATEGY_CACHE_TTL_SECONDS ?? '86400', 10);
      reply.header('Cache-Control', `max-age=${cacheTtl}, private`);

      // ── 4. Respond ────────────────────────────────────────────────────────
      const latencyMs = Date.now() - startMs;
      strategyFetchLatency.observe({ risk_level: riskLevel, cache_hit: 'false' }, latencyMs);

      strategyLog.info(
        { userId: user_id, riskLevel, latencyMs },
        'Strategy fetched',
      );

      return reply.status(200).send({
        risk_level: strategyResponse.riskLevel,
        adherence_score: Math.round(strategyResponse.adherenceScore * 100) / 100,
        strategy: {
          initial_intensity: strategyResponse.strategy.initialIntensity,
          nudge_schedule_minutes: strategyResponse.strategy.nudgeScheduleMinutes,
          max_nudges: strategyResponse.strategy.maxNudges,
          persistent_notification: strategyResponse.strategy.persistentNotification,
          vibration_pattern: strategyResponse.strategy.vibrationPattern,
        },
        computed_at: strategyResponse.computedAt,
      });
    },
  );
}
