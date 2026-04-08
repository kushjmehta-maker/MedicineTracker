import { Registry, Histogram, Gauge, Counter } from 'prom-client';

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus metrics
//
// Exposed at GET /metrics for Prometheus scraping.
// All metrics use the 'mt_' prefix (medicine tracker) to avoid collisions.
// ─────────────────────────────────────────────────────────────────────────────

export const registry = new Registry();

registry.setDefaultLabels({ app: 'medicine-tracker-backend' });

// ─── Event Ingestion ──────────────────────────────────────────────────────────

/** P50/P95/P99 latency for POST /v1/adherence/events */
export const adherenceEventIngestLatency = new Histogram({
  name: 'mt_adherence_event_ingest_latency_ms',
  help: 'Latency of adherence event ingestion in milliseconds',
  labelNames: ['status'],
  buckets: [5, 10, 25, 50, 100, 250, 500],
  registers: [registry],
});

/** Counts of inserted vs duplicate events per batch */
export const adherenceEventCounter = new Counter({
  name: 'mt_adherence_events_total',
  help: 'Total adherence events processed',
  labelNames: ['outcome'],  // 'inserted' | 'duplicate' | 'rejected'
  registers: [registry],
});

// ─── Adherence Computation ────────────────────────────────────────────────────

/** How long the nightly profile computation run takes (seconds) */
export const profileComputeDuration = new Histogram({
  name: 'mt_profile_compute_duration_seconds',
  help: 'Duration of the nightly adherence profile computation run',
  labelNames: ['status'],
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

/** Number of users processed in the last computation run */
export const profileComputeUsersGauge = new Gauge({
  name: 'mt_profile_compute_users_last_run',
  help: 'Number of user profiles computed in the most recent run',
  registers: [registry],
});

// ─── Risk Distribution ────────────────────────────────────────────────────────

/** Current distribution of users across risk tiers */
export const riskDistributionGauge = new Gauge({
  name: 'mt_risk_distribution_users',
  help: 'Number of users in each risk tier',
  labelNames: ['risk_level'],
  registers: [registry],
});

// ─── Strategy API ─────────────────────────────────────────────────────────────

/** P50/P95/P99 latency for GET /v1/users/:id/notification-strategy */
export const strategyFetchLatency = new Histogram({
  name: 'mt_strategy_fetch_latency_ms',
  help: 'Latency of notification strategy fetch in milliseconds',
  labelNames: ['risk_level', 'cache_hit'],
  buckets: [1, 5, 10, 25, 50, 100],
  registers: [registry],
});

// ─── Helper: emit risk distribution snapshot ─────────────────────────────────

export async function updateRiskDistribution(counts: {
  LOW: number;
  MEDIUM: number;
  HIGH: number;
}): Promise<void> {
  riskDistributionGauge.set({ risk_level: 'LOW' }, counts.LOW);
  riskDistributionGauge.set({ risk_level: 'MEDIUM' }, counts.MEDIUM);
  riskDistributionGauge.set({ risk_level: 'HIGH' }, counts.HIGH);
}
