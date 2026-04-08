import 'dotenv/config';
import { buildApp } from './app';
import { startCronJob, stopCronJob } from './services/adherenceComputation/AdherenceCronJob';
import { expireStaleSubscriptions } from './services/monetization/SubscriptionService';
import cron from 'node-cron';
import { closePool } from './db/client';
import { logger } from './observability/logger';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const app = await buildApp();

  // ── Start adherence computation cron ─────────────────────────────────────
  startCronJob();

  // ── Start subscription expiry sweep (every hour) ──────────────────────────
  cron.schedule('0 * * * *', () => {
    expireStaleSubscriptions().catch((err) =>
      logger.error({ err }, 'Subscription expiry sweep failed'),
    );
  });

  // ── Start HTTP server ─────────────────────────────────────────────────────
  await app.listen({ port: PORT, host: HOST });
  logger.info({ port: PORT, host: HOST }, 'Server listening');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');
    stopCronJob();
    await app.close();
    await closePool();
    logger.info('Server shut down cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
