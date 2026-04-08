import {
  computeConsistencyScore,
  computeAdherenceScore,
  classifyRisk,
  buildProfile,
} from '../src/services/adherenceComputation/AdherenceComputationService';

// ─────────────────────────────────────────────────────────────────────────────
// Adherence Computation — unit tests
//
// All pure functions tested without DB.  The DB-backed functions are covered
// by integration tests (not included here — require a running PostgreSQL).
// ─────────────────────────────────────────────────────────────────────────────

describe('computeConsistencyScore', () => {
  test('null std dev (0 or 1 data points) → 1.0', () => {
    expect(computeConsistencyScore(null)).toBe(1.0);
  });

  test('zero std dev (perfectly consistent) → 1.0', () => {
    expect(computeConsistencyScore(0)).toBe(1.0);
  });

  test('std dev = 900s (15 min) → 0.5', () => {
    expect(computeConsistencyScore(900)).toBeCloseTo(0.5, 5);
  });

  test('std dev = 1800s (30 min) → 0.0', () => {
    expect(computeConsistencyScore(1800)).toBe(0.0);
  });

  test('std dev > 1800s → clamped to 0.0', () => {
    expect(computeConsistencyScore(3600)).toBe(0.0);
  });
});

describe('computeAdherenceScore', () => {
  test('perfect user → score = 1.0', () => {
    const score = computeAdherenceScore({
      adherenceRate: 1.0,
      avgDelayMinutes: 0,
      snoozeRate: 0,
      consistencyScore: 1.0,
    });
    expect(score).toBeCloseTo(1.0, 5);
  });

  test('zero adherence, max delay, max snooze → near 0', () => {
    const score = computeAdherenceScore({
      adherenceRate: 0,
      avgDelayMinutes: 60,
      snoozeRate: 1.0,
      consistencyScore: 0,
    });
    expect(score).toBe(0);
  });

  test('formula coefficients: 0.5 + 0.2 + 0.2 + 0.1 = 1.0', () => {
    // All component scores = 1.0
    const score = computeAdherenceScore({
      adherenceRate: 1.0,
      avgDelayMinutes: 0,
      snoozeRate: 0,
      consistencyScore: 1.0,
    });
    expect(score).toBe(1.0);
  });

  test('70% adherence, 5 min avg delay, 10% snooze, 90% consistency', () => {
    const adherenceRate = 0.7;
    const avgDelayMinutes = 5;
    const snoozeRate = 0.1;
    const consistencyScore = 0.9;

    const delayScore = Math.max(0, 1 - avgDelayMinutes / 60);   // ~0.9167
    const snoozeScore = Math.max(0, 1 - snoozeRate);            // 0.9

    const expected =
      0.5 * adherenceRate +
      0.2 * delayScore +
      0.2 * snoozeScore +
      0.1 * consistencyScore;

    const actual = computeAdherenceScore({ adherenceRate, avgDelayMinutes, snoozeRate, consistencyScore });
    expect(actual).toBeCloseTo(expected, 10);
  });

  test('result is clamped to [0, 1]', () => {
    // Extremely bad inputs should not produce negative scores
    const score = computeAdherenceScore({
      adherenceRate: -0.5, // shouldn't happen but defensive
      avgDelayMinutes: 200,
      snoozeRate: 2.0,
      consistencyScore: -1.0,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('classifyRisk', () => {
  test('score >= 0.85 → LOW', () => {
    expect(classifyRisk(0.85)).toBe('LOW');
    expect(classifyRisk(1.0)).toBe('LOW');
    expect(classifyRisk(0.851)).toBe('LOW');
  });

  test('score 0.60 – 0.849 → MEDIUM', () => {
    expect(classifyRisk(0.60)).toBe('MEDIUM');
    expect(classifyRisk(0.849)).toBe('MEDIUM');
    expect(classifyRisk(0.72)).toBe('MEDIUM');
  });

  test('score < 0.60 → HIGH', () => {
    expect(classifyRisk(0.0)).toBe('HIGH');
    expect(classifyRisk(0.599)).toBe('HIGH');
    expect(classifyRisk(0.4)).toBe('HIGH');
  });

  test('boundary: exactly 0.60 is MEDIUM (not HIGH)', () => {
    expect(classifyRisk(0.60)).toBe('MEDIUM');
  });

  test('boundary: exactly 0.85 is LOW (not MEDIUM)', () => {
    expect(classifyRisk(0.85)).toBe('LOW');
  });
});

describe('buildProfile', () => {
  function makeRaw(overrides: Record<string, string | null> = {}) {
    return {
      user_id: 'user-1',
      total_scheduled: '10',
      taken_on_time: '8',
      total_taken: '9',
      avg_delay_seconds: '120',    // 2 minutes
      total_snoozed: '2',
      total_missed: '1',
      stddev_delay_seconds: '60',  // 1 minute std dev
      last_30d_taken: '25',
      last_30d_scheduled: '30',
      ...overrides,
    };
  }

  test('correctly computes adherence_rate', () => {
    const p = buildProfile(makeRaw());
    // taken_on_time(8) / total_scheduled(10) = 0.8
    expect(p.adherenceRate).toBeCloseTo(0.8, 10);
  });

  test('correctly computes avg_delay_minutes', () => {
    const p = buildProfile(makeRaw({ avg_delay_seconds: '300' }));
    expect(p.avgDelayMinutes).toBeCloseTo(5, 10);
  });

  test('correctly computes snooze_rate', () => {
    const p = buildProfile(makeRaw());
    // snoozed(2) / scheduled(10) = 0.2
    expect(p.snoozeRate).toBeCloseTo(0.2, 10);
  });

  test('correctly computes miss_rate', () => {
    const p = buildProfile(makeRaw());
    // missed(1) / scheduled(10) = 0.1
    expect(p.missRate).toBeCloseTo(0.1, 10);
  });

  test('assigns correct 30d counts', () => {
    const p = buildProfile(makeRaw());
    expect(p.last30dTaken).toBe(25);
    expect(p.last30dScheduled).toBe(30);
  });

  test('user with zero scheduled events → adherence_rate = 1.0 (default safe)', () => {
    const p = buildProfile(makeRaw({ total_scheduled: '0', taken_on_time: '0' }));
    expect(p.adherenceRate).toBe(1.0);
    expect(p.riskLevel).toBe('LOW');
  });

  test('user with null avg_delay_seconds → avgDelayMinutes = 0', () => {
    const p = buildProfile(makeRaw({ avg_delay_seconds: null }));
    expect(p.avgDelayMinutes).toBe(0);
  });

  test('user with null stddev_delay → consistencyScore = 1.0', () => {
    const p = buildProfile(makeRaw({ stddev_delay_seconds: null }));
    expect(p.consistencyScore).toBe(1.0);
  });

  test('full pipeline: known inputs produce expected risk level', () => {
    // adherence_rate = 8/10 = 0.80, avg_delay = 2min, snooze_rate = 0.2, consistency ≈ 0.967
    const p = buildProfile(makeRaw());
    // Manual calculation:
    // delay_score = 1 - 2/60 ≈ 0.9667
    // snooze_score = 1 - 0.2 = 0.8
    // consistency = 1 - 60/1800 ≈ 0.9667
    // score = 0.5*0.8 + 0.2*0.9667 + 0.2*0.8 + 0.1*0.9667
    //       = 0.4 + 0.1933 + 0.16 + 0.0967 = 0.850
    expect(p.riskLevel).toBe('LOW');
    expect(p.adherenceScore).toBeGreaterThanOrEqual(0.85);
  });
});
