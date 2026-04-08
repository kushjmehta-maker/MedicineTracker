import {
  computeAdherenceScore,
  classifyRisk,
  buildProfile,
} from '../src/services/adherenceComputation/AdherenceComputationService';

// ─────────────────────────────────────────────────────────────────────────────
// Risk Classification — unit tests
//
// Exhaustive tests of the scoring formula and tier boundaries, covering
// every edge case mentioned in the spec.
// ─────────────────────────────────────────────────────────────────────────────

/** Reference implementation of the PRD formula for cross-checking */
function referenceScore(p: {
  adherenceRate: number;
  avgDelayMinutes: number;
  snoozeRate: number;
  consistencyScore: number;
}): number {
  const delayScore = Math.max(0, 1 - p.avgDelayMinutes / 60);
  const snoozeScore = Math.max(0, 1 - p.snoozeRate);
  return (
    0.5 * p.adherenceRate +
    0.2 * delayScore +
    0.2 * snoozeScore +
    0.1 * p.consistencyScore
  );
}

describe('Scoring formula correctness', () => {
  const cases = [
    { adherenceRate: 1.0, avgDelayMinutes: 0, snoozeRate: 0, consistencyScore: 1.0 },
    { adherenceRate: 0.5, avgDelayMinutes: 30, snoozeRate: 0.5, consistencyScore: 0.5 },
    { adherenceRate: 0.0, avgDelayMinutes: 60, snoozeRate: 1.0, consistencyScore: 0.0 },
    { adherenceRate: 0.9, avgDelayMinutes: 3, snoozeRate: 0.05, consistencyScore: 0.95 },
    { adherenceRate: 0.75, avgDelayMinutes: 10, snoozeRate: 0.2, consistencyScore: 0.8 },
  ];

  test.each(cases)(
    'matches reference formula for ar=%f, delay=%f, snooze=%f, cons=%f',
    (input) => {
      const actual = computeAdherenceScore(input);
      const expected = Math.min(1, Math.max(0, referenceScore(input)));
      expect(actual).toBeCloseTo(expected, 10);
    },
  );
});

describe('delay_score component', () => {
  test('0 min delay → delay_score = 1.0', () => {
    const s1 = computeAdherenceScore({ adherenceRate: 0, avgDelayMinutes: 0, snoozeRate: 0, consistencyScore: 0 });
    const s2 = computeAdherenceScore({ adherenceRate: 0, avgDelayMinutes: 0.0001, snoozeRate: 0, consistencyScore: 0 });
    expect(s1).toBeGreaterThan(s2);
  });

  test('60 min delay → delay_score = 0.0 (not negative)', () => {
    const score = computeAdherenceScore({
      adherenceRate: 0,
      avgDelayMinutes: 60,
      snoozeRate: 0,
      consistencyScore: 0,
    });
    // delay contribution = 0.2 * max(0, 1-1) = 0
    expect(score).toBe(0);
  });

  test('>60 min delay → delay_score clamped at 0.0', () => {
    const at60 = computeAdherenceScore({ adherenceRate: 0.5, avgDelayMinutes: 60, snoozeRate: 0, consistencyScore: 0 });
    const at90 = computeAdherenceScore({ adherenceRate: 0.5, avgDelayMinutes: 90, snoozeRate: 0, consistencyScore: 0 });
    // Both should give the same delay contribution (0)
    expect(at60).toBe(at90);
  });
});

describe('snooze_score component', () => {
  test('0% snooze rate → snooze_score = 1.0', () => {
    const withSnooze0 = computeAdherenceScore({ adherenceRate: 1, avgDelayMinutes: 0, snoozeRate: 0, consistencyScore: 1 });
    const withSnooze1 = computeAdherenceScore({ adherenceRate: 1, avgDelayMinutes: 0, snoozeRate: 0.01, consistencyScore: 1 });
    expect(withSnooze0).toBeGreaterThan(withSnooze1);
  });

  test('100% snooze rate → snooze_score = 0', () => {
    const score = computeAdherenceScore({
      adherenceRate: 0,
      avgDelayMinutes: 0,
      snoozeRate: 1.0,
      consistencyScore: 0,
    });
    // Only consistency contributes 0, delay contributes 0.2, adherence 0, snooze 0
    const expected = 0.2; // delay_score = 1, contribution = 0.2
    expect(score).toBeCloseTo(expected, 10);
  });
});

describe('Risk tier boundaries', () => {
  test.each([
    [0.85, 'LOW'],
    [0.86, 'LOW'],
    [1.00, 'LOW'],
    [0.849, 'MEDIUM'],
    [0.60, 'MEDIUM'],
    [0.601, 'MEDIUM'],
    [0.599, 'HIGH'],
    [0.30, 'HIGH'],
    [0.00, 'HIGH'],
  ] as const)('score=%f → %s', (score, expected) => {
    expect(classifyRisk(score)).toBe(expected);
  });
});

describe('End-to-end: typical Indian user cohorts', () => {
  test('Highly adherent user (1 snooze, always on time) → LOW risk', () => {
    const p = buildProfile({
      user_id: 'u1',
      total_scheduled: '14',
      taken_on_time: '13',
      total_taken: '13',
      avg_delay_seconds: '90',
      total_snoozed: '1',
      total_missed: '1',
      stddev_delay_seconds: '30',
      last_30d_taken: '55',
      last_30d_scheduled: '60',
    });
    expect(p.riskLevel).toBe('LOW');
    expect(p.adherenceScore).toBeGreaterThanOrEqual(0.85);
  });

  test('Moderate user (several misses, frequent snoozing) → MEDIUM risk', () => {
    const p = buildProfile({
      user_id: 'u2',
      total_scheduled: '14',
      taken_on_time: '8',
      total_taken: '10',
      avg_delay_seconds: '600',  // 10 min avg
      total_snoozed: '5',
      total_missed: '3',
      stddev_delay_seconds: '300',
      last_30d_taken: '40',
      last_30d_scheduled: '60',
    });
    expect(p.riskLevel).toBe('MEDIUM');
  });

  test('Low-adherence user (many misses) → HIGH risk', () => {
    const p = buildProfile({
      user_id: 'u3',
      total_scheduled: '14',
      taken_on_time: '3',
      total_taken: '5',
      avg_delay_seconds: '2400',  // 40 min avg
      total_snoozed: '6',
      total_missed: '7',
      stddev_delay_seconds: '1200',
      last_30d_taken: '15',
      last_30d_scheduled: '60',
    });
    expect(p.riskLevel).toBe('HIGH');
    expect(p.adherenceScore).toBeLessThan(0.60);
  });

  test('New user with zero events → LOW risk (safe default)', () => {
    const p = buildProfile({
      user_id: 'u4',
      total_scheduled: '0',
      taken_on_time: '0',
      total_taken: '0',
      avg_delay_seconds: null,
      total_snoozed: '0',
      total_missed: '0',
      stddev_delay_seconds: null,
      last_30d_taken: '0',
      last_30d_scheduled: '0',
    });
    expect(p.riskLevel).toBe('LOW');
    expect(p.adherenceScore).toBe(1.0);
  });
});
