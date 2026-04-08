import cron from 'node-cron';
import { getPool } from '../../db/client';
import {
  iterateActiveUserIdBatches,
  computeAndPersistBatch,
} from './AdherenceComputationService';
import { computationLog } from '../../observability/logger';
import {
  profileComputeDuration,
  profileComputeUsersGauge,
  updateRiskDistribution,
} from '../../observability/metrics';

// ─────────────────────────────────────────────────────────────────────────────
// AdherenceCronJob
//
// Runs the full adherence profile computation nightly at 2 AM UTC.
// Uses cursor-based pagination to handle up to 500k users without OOM.
//
// Architecture note:
//   The iteration + compute loop is extracted so it can be triggered manually
//   (via runFullComputation()) in tests, admin tooling, or future streaming
//   upgrades.
//
// To upgrade to streaming: replace the cron with a Kafka consumer and feed
//   user IDs through iterateActiveUserIdBatches() one at a time.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BATCH_SIZE = parseInt(process.env.ADHERENCE_BATCH_SIZE ?? '1000', 10);
const DEFAULT_CRON = process.env.ADHERENCE_CRON_SCHEDULE ?? '0 2 * * *';

let _cronTask: cron.ScheduledTask | null = null;

export function startCronJob(): void {
  if (_cronTask) return;

  _cronTask = cron.schedule(DEFAULT_CRON, () => {
    runFullComputation().catch((err) =>
      computationLog.error({ err }, 'Nightly adherence computation failed'),
    );
  });

  computationLog.info(
    { schedule: DEFAULT_CRON, batchSize: DEFAULT_BATCH_SIZE },
    'Adherence computation cron started',
  );
}

export function stopCronJob(): void {
  if (_cronTask) {
    _cronTask.stop();
    _cronTask = null;
  }
}

/**
 * Run a full computation pass over all active users.
 * Can be called directly for ad-hoc runs or integration tests.
 */
export async function runFullComputation(
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<{ usersProcessed: number; durationMs: number; errors: number }> {
  const startMs = Date.now();
  const pool = getPool();
  let usersProcessed = 0;
  let errors = 0;

  computationLog.info({ batchSize }, 'Adherence computation started');

  for await (const userIdBatch of iterateActiveUserIdBatches(batchSize, pool)) {
    try {
      const count = await computeAndPersistBatch(userIdBatch, pool);
      usersProcessed += count;
    } catch (err) {
      errors++;
      computationLog.error({ err, batchUserCount: userIdBatch.length }, 'Batch compute failed');
      // Continue to next batch — partial failure is acceptable
    }
  }

  const durationMs = Date.now() - startMs;
  const durationSec = durationMs / 1000;

  // ── Metrics ────────────────────────────────────────────────────────────────
  profileComputeDuration.observe({ status: errors > 0 ? 'partial' : 'success' }, durationSec);
  profileComputeUsersGauge.set(usersProcessed);

  // Update risk distribution snapshot
  await refreshRiskDistributionMetrics(pool);

  computationLog.info(
    { usersProcessed, durationMs, errors },
    'Adherence computation complete',
  );

  return { usersProcessed, durationMs, errors };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function refreshRiskDistributionMetrics(pool: ReturnType<typeof getPool>): Promise<void> {
  try {
    const { rows } = await pool.query<{ risk_level: string; count: string }>(
      `SELECT risk_level, COUNT(*) AS count
       FROM user_adherence_profiles
       GROUP BY risk_level`,
    );

    const dist = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const r of rows) {
      const level = r.risk_level as 'LOW' | 'MEDIUM' | 'HIGH';
      dist[level] = parseInt(r.count, 10);
    }

    await updateRiskDistribution(dist);
  } catch (err) {
    computationLog.warn({ err }, 'Failed to refresh risk distribution metrics');
  }
}
