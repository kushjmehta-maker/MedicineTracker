import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { registry } from './observability/metrics';
import { logger } from './observability/logger';
import { authMiddleware } from './middleware/authMiddleware';
import { registerEventIngestionRoutes } from './services/eventIngestion/EventIngestionRouter';
import { registerNotificationStrategyRoutes } from './services/notificationStrategy/NotificationStrategyRouter';
import { registerBillingRoutes } from './routers/billing/BillingRouter';
import { registerSubscriptionRoutes } from './routers/billing/SubscriptionRouter';
import { registerBillingProvider } from './services/monetization/billing/BillingProvider';
import { PlayStoreBillingProvider } from './services/monetization/billing/PlayStoreBillingProvider';
import { AppStoreBillingProvider } from './services/monetization/billing/AppStoreBillingProvider';

// ─────────────────────────────────────────────────────────────────────────────
// Application factory
//
// Separated from server.ts so the app instance can be imported in tests
// and used with fastify.inject() without binding to a port.
// ─────────────────────────────────────────────────────────────────────────────

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own pino instance
    trustProxy: true,
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    // Stricter limit on auth-adjacent write endpoints
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      error: 'Too many requests',
      retryAfter: context.after,
    }),
  });

  // ── Global auth preHandler ────────────────────────────────────────────────
  app.addHook('preHandler', authMiddleware);

  // ── Global error handler ──────────────────────────────────────────────────
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    logger.error({ err: error, url: request.url }, 'Unhandled error');
    reply.status(error.statusCode ?? 500).send({
      error: error.message ?? 'Internal server error',
    });
  });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async (_, reply) => {
    reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Prometheus metrics endpoint ───────────────────────────────────────────
  app.get('/metrics', async (_, reply) => {
    reply
      .header('Content-Type', registry.contentType)
      .send(await registry.metrics());
  });

  // ── Register billing providers ────────────────────────────────────────────
  registerBillingProvider(new PlayStoreBillingProvider());
  registerBillingProvider(new AppStoreBillingProvider());

  // ── Domain routes ─────────────────────────────────────────────────────────
  await registerEventIngestionRoutes(app);
  await registerNotificationStrategyRoutes(app);
  await registerBillingRoutes(app);
  await registerSubscriptionRoutes(app);

  return app;
}
