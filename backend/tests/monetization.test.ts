/**
 * monetization.test.ts
 *
 * Unit + integration tests for:
 *   • SubscriptionService
 *   • FeatureGateService
 *   • UsageLimitService
 *   • featureGuard / usageGuard Fastify hooks
 *   • BillingRouter (HTTP layer)
 *
 * All DB calls are mocked via jest.mock so no PostgreSQL is needed.
 */

// ─── Mock DB client ───────────────────────────────────────────────────────────

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClientQuery = jest.fn();

jest.mock('../src/db/client', () => ({
  getPool: () => ({ query: mockQuery, connect: mockConnect }),
  withTransaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn({ query: mockClientQuery, release: mockRelease })),
  _setPoolForTesting: jest.fn(),
}));

// ─── Mock PlanCache (static data, no DB needed for guard tests) ───────────────

const mockGetFeatureMatrix = jest.fn();
const mockGetLimitMatrix   = jest.fn();

jest.mock('../src/services/monetization/PlanCache', () => ({
  getFeatureMatrix: () => mockGetFeatureMatrix(),
  getLimitMatrix:   () => mockGetLimitMatrix(),
  invalidatePlanCache: jest.fn(),
  _resetCache: jest.fn(),
}));

// ─── Mock prom-client ─────────────────────────────────────────────────────────

jest.mock('prom-client', () => {
  const actual = jest.requireActual('prom-client');
  const reg = new actual.Registry();
  return {
    ...actual,
    Registry: jest.fn(() => reg),
    Histogram: jest.fn().mockImplementation(() => ({ observe: jest.fn() })),
    Gauge:     jest.fn().mockImplementation(() => ({ set: jest.fn() })),
    Counter:   jest.fn().mockImplementation(() => ({ inc: jest.fn() })),
  };
});

import {
  getUserPlan,
  isPremium,
  getActiveSubscription,
  _resetSubscriptionCache,
} from '../src/services/monetization/SubscriptionService';
import {
  isFeatureEnabled,
  assertFeatureAccess,
  getUserFeatures,
  getAdaptiveTier,
} from '../src/services/monetization/FeatureGateService';
import {
  getUsage,
  checkLimit,
  assertLimit,
  incrementUsage,
  decrementUsage,
} from '../src/services/monetization/UsageLimitService';
import { FeatureGateError, UsageLimitError } from '../src/services/monetization/types';
import { buildApp } from '../src/app';
import { FastifyInstance } from 'fastify';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FREE_UUID    = '00000000-0000-0000-0000-000000000001';
const PREMIUM_UUID = '00000000-0000-0000-0000-000000000002';
const FAMILY_UUID  = '00000000-0000-0000-0000-000000000003';

function makeActiveSub(planType: 'PREMIUM' | 'FAMILY') {
  return {
    id: 'sub-1',
    user_id: PREMIUM_UUID,
    plan_type: planType,
    status: 'ACTIVE',
    start_date: new Date('2026-01-01'),
    end_date: null,
    provider: 'PLAY_STORE',
    provider_subscription_id: 'GPA.1234',
    grace_period_minutes: 1440,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

const FULL_FEATURE_MATRIX = {
  FREE: {
    reminders: true,
    missed_dose_detection: true,
    basic_adherence: true,
    advanced_adherence: false,
    adaptive_notifications: false,
    caregiver_access: false,
    priority_notifications: false,
    export_data: false,
    unlimited_medicines: false,
    doctor_followups: true,
  },
  PREMIUM: {
    reminders: true,
    missed_dose_detection: true,
    basic_adherence: true,
    advanced_adherence: true,
    adaptive_notifications: true,
    caregiver_access: true,
    priority_notifications: true,
    export_data: true,
    unlimited_medicines: true,
    doctor_followups: true,
  },
  FAMILY: {
    reminders: true,
    missed_dose_detection: true,
    basic_adherence: true,
    advanced_adherence: true,
    adaptive_notifications: true,
    caregiver_access: true,
    priority_notifications: true,
    export_data: true,
    unlimited_medicines: true,
    doctor_followups: true,
  },
};

const FULL_LIMIT_MATRIX = {
  FREE:    { medicines_count: 10,   caregivers_count: 0,    followups_count: 5    },
  PREMIUM: { medicines_count: null, caregivers_count: 5,    followups_count: null },
  FAMILY:  { medicines_count: null, caregivers_count: 20,   followups_count: null },
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetSubscriptionCache();
  mockGetFeatureMatrix.mockResolvedValue(FULL_FEATURE_MATRIX);
  mockGetLimitMatrix.mockResolvedValue(FULL_LIMIT_MATRIX);
});

// =============================================================================
// SubscriptionService
// =============================================================================

describe('SubscriptionService', () => {
  describe('getUserPlan', () => {
    test('returns FREE when no active subscription row exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await getUserPlan(FREE_UUID)).toBe('FREE');
    });

    test('returns PREMIUM for a user with an active PREMIUM subscription', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeActiveSub('PREMIUM')] });
      expect(await getUserPlan(PREMIUM_UUID)).toBe('PREMIUM');
    });

    test('returns FAMILY for a user with an active FAMILY subscription', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...makeActiveSub('FAMILY'), user_id: FAMILY_UUID }],
      });
      expect(await getUserPlan(FAMILY_UUID)).toBe('FAMILY');
    });

    test('returns cached plan on second call without a DB hit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeActiveSub('PREMIUM')] });
      await getUserPlan(PREMIUM_UUID);
      await getUserPlan(PREMIUM_UUID);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('falls back to FREE when DB throws (safety invariant)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB unavailable'));
      expect(await getUserPlan('any-uuid')).toBe('FREE');
    });
  });

  describe('isPremium', () => {
    test('returns false for FREE user', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await isPremium(FREE_UUID)).toBe(false);
    });

    test('returns true for PREMIUM user', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeActiveSub('PREMIUM')] });
      expect(await isPremium(PREMIUM_UUID)).toBe(true);
    });

    test('returns true for FAMILY user', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...makeActiveSub('FAMILY'), user_id: FAMILY_UUID }],
      });
      expect(await isPremium(FAMILY_UUID)).toBe(true);
    });
  });

  describe('getActiveSubscription — grace period', () => {
    test('returns null and expires row when grace window has elapsed', async () => {
      const endDate = new Date(Date.now() - 2 * 3600_000); // 2h ago
      const sub = {
        ...makeActiveSub('PREMIUM'),
        end_date: endDate,
        grace_period_minutes: 60,  // 1h grace — already elapsed
      };
      mockQuery
        .mockResolvedValueOnce({ rows: [sub] }) // getActiveSubscription SELECT
        .mockResolvedValueOnce({ rows: [] });    // _expireSubscription UPDATE

      const result = await getActiveSubscription(PREMIUM_UUID);
      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        expect.stringContaining("SET status = 'EXPIRED'"),
        expect.any(Array),
      );
    });

    test('returns subscription when within grace window', async () => {
      const endDate = new Date(Date.now() - 30 * 60_000); // 30 min ago
      const sub = {
        ...makeActiveSub('PREMIUM'),
        end_date: endDate,
        grace_period_minutes: 1440, // 24h grace — still in window
      };
      mockQuery.mockResolvedValueOnce({ rows: [sub] });
      const result = await getActiveSubscription(PREMIUM_UUID);
      expect(result).not.toBeNull();
      expect(result?.planType).toBe('PREMIUM');
    });
  });
});

// =============================================================================
// FeatureGateService
// =============================================================================

describe('FeatureGateService', () => {
  describe('isFeatureEnabled', () => {
    test('FREE user: reminders always enabled (ungated)', async () => {
      // No DB call needed for ungated features
      mockQuery.mockResolvedValue({ rows: [] });
      expect(await isFeatureEnabled(FREE_UUID, 'reminders')).toBe(true);
    });

    test('FREE user: missed_dose_detection always enabled (ungated)', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      expect(await isFeatureEnabled(FREE_UUID, 'missed_dose_detection')).toBe(true);
    });

    test('FREE user: caregiver_access disabled', async () => {
      mockQuery.mockResolvedValue({ rows: [] }); // no active sub → FREE
      expect(await isFeatureEnabled(FREE_UUID, 'caregiver_access')).toBe(false);
    });

    test('FREE user: advanced_adherence disabled', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      expect(await isFeatureEnabled(FREE_UUID, 'advanced_adherence')).toBe(false);
    });

    test('PREMIUM user: caregiver_access enabled', async () => {
      mockQuery.mockResolvedValue({ rows: [makeActiveSub('PREMIUM')] });
      expect(await isFeatureEnabled(PREMIUM_UUID, 'caregiver_access')).toBe(true);
    });

    test('PREMIUM user: advanced_adherence enabled', async () => {
      mockQuery.mockResolvedValue({ rows: [makeActiveSub('PREMIUM')] });
      expect(await isFeatureEnabled(PREMIUM_UUID, 'advanced_adherence')).toBe(true);
    });

    test('Globally disabled flag → false regardless of plan', async () => {
      mockQuery.mockResolvedValue({ rows: [makeActiveSub('PREMIUM')] });
      // Override matrix: premium has the feature but the flag is globally off
      mockGetFeatureMatrix.mockResolvedValueOnce({
        ...FULL_FEATURE_MATRIX,
        PREMIUM: { ...FULL_FEATURE_MATRIX.PREMIUM, caregiver_access: false },
      });
      expect(await isFeatureEnabled(PREMIUM_UUID, 'caregiver_access')).toBe(false);
    });
  });

  describe('assertFeatureAccess', () => {
    test('does not throw for an enabled feature', async () => {
      mockQuery.mockResolvedValue({ rows: [makeActiveSub('PREMIUM')] });
      await expect(assertFeatureAccess(PREMIUM_UUID, 'caregiver_access')).resolves.toBeUndefined();
    });

    test('throws FeatureGateError (403) for a disabled feature', async () => {
      mockQuery.mockResolvedValue({ rows: [] }); // FREE plan
      const err = await assertFeatureAccess(FREE_UUID, 'caregiver_access').catch((e) => e);
      expect(err).toBeInstanceOf(FeatureGateError);
      expect(err.statusCode).toBe(403);
      expect(err.featureKey).toBe('caregiver_access');
    });
  });

  describe('getAdaptiveTier', () => {
    test('FREE user → basic tier', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      expect(await getAdaptiveTier(FREE_UUID)).toBe('basic');
    });

    test('PREMIUM user → advanced tier', async () => {
      mockQuery.mockResolvedValue({ rows: [makeActiveSub('PREMIUM')] });
      expect(await getAdaptiveTier(PREMIUM_UUID)).toBe('advanced');
    });
  });

  describe('getUserFeatures', () => {
    test('FREE user has all ungated features as true', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const features = await getUserFeatures(FREE_UUID);
      expect(features.reminders).toBe(true);
      expect(features.missed_dose_detection).toBe(true);
      expect(features.doctor_followups).toBe(true);
    });

    test('FREE user has caregiver_access as false', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const features = await getUserFeatures(FREE_UUID);
      expect(features.caregiver_access).toBe(false);
    });

    test('PREMIUM user has all features as true', async () => {
      mockQuery.mockResolvedValue({ rows: [makeActiveSub('PREMIUM')] });
      const features = await getUserFeatures(PREMIUM_UUID);
      for (const [, enabled] of Object.entries(features)) {
        expect(enabled).toBe(true);
      }
    });
  });
});

// =============================================================================
// UsageLimitService
// =============================================================================

describe('UsageLimitService', () => {
  describe('getUsage', () => {
    test('returns 0 when no usage row exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await getUsage(FREE_UUID, 'medicines_count')).toBe(0);
    });

    test('returns current_value from DB', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ current_value: 7 }] });
      expect(await getUsage(FREE_UUID, 'medicines_count')).toBe(7);
    });
  });

  describe('checkLimit', () => {
    test('FREE user at 9/10 medicines → within limit', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })             // getActiveSubscription → FREE
        .mockResolvedValueOnce({ rows: [{ current_value: 9 }] }); // getUsage
      expect(await checkLimit(FREE_UUID, 'medicines_count')).toBe(true);
    });

    test('FREE user at 10/10 medicines → at limit', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ current_value: 10 }] });
      expect(await checkLimit(FREE_UUID, 'medicines_count')).toBe(false);
    });

    test('PREMIUM user with null limit → always within limit', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [makeActiveSub('PREMIUM')] })
        .mockResolvedValueOnce({ rows: [{ current_value: 500 }] });
      expect(await checkLimit(PREMIUM_UUID, 'medicines_count')).toBe(true);
    });
  });

  describe('assertLimit', () => {
    test('does not throw when under limit', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ current_value: 5 }] });
      await expect(assertLimit(FREE_UUID, 'medicines_count')).resolves.toBeUndefined();
    });

    test('throws UsageLimitError (429) when at limit', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })    // getPlanLimit → getUserPlan
        .mockResolvedValueOnce({ rows: [{ current_value: 10 }] }); // getUsage
      const err = await assertLimit(FREE_UUID, 'medicines_count').catch((e) => e);
      expect(err).toBeInstanceOf(UsageLimitError);
      expect(err.statusCode).toBe(429);
      expect(err.metricKey).toBe('medicines_count');
      expect(err.currentValue).toBe(10);
      expect(err.limitValue).toBe(10);
    });
  });

  describe('incrementUsage', () => {
    test('increments counter and returns new value', async () => {
      // getPlanLimit call (getUserPlan → no active sub)
      mockQuery
        .mockResolvedValueOnce({ rows: [] })                      // getPlanLimit getUserPlan
        .mockResolvedValueOnce({ rows: [{ current_value: 8 }] }); // INSERT ... RETURNING
      const newVal = await incrementUsage(FREE_UUID, 'medicines_count');
      expect(newVal).toBe(8);
    });

    test('throws UsageLimitError when atomic increment is blocked at limit', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })   // getUserPlan → FREE
        .mockResolvedValueOnce({ rows: [] })   // INSERT returns 0 rows (blocked)
        .mockResolvedValueOnce({ rows: [{ current_value: 10 }] }) // getUsage for error
        .mockResolvedValueOnce({ rows: [] });  // getUserPlan for error msg
      const err = await incrementUsage(FREE_UUID, 'medicines_count').catch((e) => e);
      expect(err).toBeInstanceOf(UsageLimitError);
    });

    test('PREMIUM user: increments past FREE limit without error', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [makeActiveSub('PREMIUM')] }) // getPlanLimit
        .mockResolvedValueOnce({ rows: [{ current_value: 15 }] });   // INSERT RETURNING
      const newVal = await incrementUsage(PREMIUM_UUID, 'medicines_count');
      expect(newVal).toBe(15);
    });
  });

  describe('decrementUsage', () => {
    test('decrements counter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ current_value: 6 }] });
      expect(await decrementUsage(FREE_UUID, 'medicines_count')).toBe(6);
    });

    test('floors at 0 (no negative counters)', async () => {
      // GREATEST(..., 0) in SQL ensures this; verify the SQL contains GREATEST
      await decrementUsage(FREE_UUID, 'medicines_count');
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('GREATEST');
    });
  });
});

// =============================================================================
// HTTP Guards — via Fastify inject()
// =============================================================================

describe('featureGuard and usageGuard (HTTP layer)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();

    // Register a test route that uses both guards
    app.post('/test/gated-feature', {
      preHandler: [
        async (req: FastifyRequest & { user?: { id: string } }, reply) => {
          (req as FastifyRequest & { user: { id: string } }).user = {
            id: (req.query as Record<string, string>).uid,
          };
        },
        (await import('../src/middleware/featureGuard')).requireFeature('caregiver_access'),
      ],
    }, async (_req, reply) => reply.send({ ok: true }));

    app.post('/test/limited-route', {
      preHandler: [
        async (req: FastifyRequest & { user?: { id: string } }, reply) => {
          (req as FastifyRequest & { user: { id: string } }).user = {
            id: (req.query as Record<string, string>).uid,
          };
        },
        (await import('../src/middleware/usageGuard')).enforceLimit('medicines_count'),
      ],
    }, async (_req, reply) => reply.send({ ok: true }));
  });

  afterAll(() => app.close());

  test('FREE user blocked (403) by feature guard for caregiver_access', async () => {
    mockQuery.mockResolvedValue({ rows: [] }); // no sub → FREE

    const res = await app.inject({
      method: 'POST',
      url: `/test/gated-feature?uid=${FREE_UUID}`,
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('FEATURE_GATED');
    expect(body.feature).toBe('caregiver_access');
  });

  test('PREMIUM user passes feature guard for caregiver_access', async () => {
    mockQuery.mockResolvedValue({ rows: [makeActiveSub('PREMIUM')] });

    const res = await app.inject({
      method: 'POST',
      url: `/test/gated-feature?uid=${PREMIUM_UUID}`,
    });
    expect(res.statusCode).toBe(200);
  });

  test('FREE user blocked (429) by usage guard at medicines_count limit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                         // getUserPlan
      .mockResolvedValueOnce({ rows: [{ current_value: 10 }] });  // getUsage

    const res = await app.inject({
      method: 'POST',
      url: `/test/limited-route?uid=${FREE_UUID}`,
    });
    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('USAGE_LIMIT_EXCEEDED');
    expect(body.current).toBe(10);
    expect(body.limit).toBe(10);
  });

  test('FREE user passes usage guard when under limit (9/10)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ current_value: 9 }] });

    const res = await app.inject({
      method: 'POST',
      url: `/test/limited-route?uid=${FREE_UUID}`,
    });
    expect(res.statusCode).toBe(200);
  });
});

// =============================================================================
// BillingRouter — HTTP layer
// =============================================================================

describe('GET /v1/billing/plans', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(() => app.close());

  test('returns all three plan types', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/billing/plans' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const types = body.plans.map((p: { type: string }) => p.type);
    expect(types).toContain('FREE');
    expect(types).toContain('PREMIUM');
    expect(types).toContain('FAMILY');
  });

  test('FREE plan has medicines_limit of 10', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/billing/plans' });
    const free = JSON.parse(res.body).plans.find((p: { type: string }) => p.type === 'FREE');
    expect(free.medicines_limit).toBe(10);
  });

  test('PREMIUM plan has null medicines_limit (unlimited)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/billing/plans' });
    const premium = JSON.parse(res.body).plans.find((p: { type: string }) => p.type === 'PREMIUM');
    expect(premium.medicines_limit).toBeNull();
  });
});

describe('POST /v1/billing/webhook/:provider', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(() => app.close());

  test('returns 404 for unknown provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/webhook/UNKNOWN_PROVIDER',
      payload: Buffer.from('{}'),
    });
    expect(res.statusCode).toBe(404);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('Edge cases', () => {
  test('Subscription expiry downgrades access: expired sub → FREE plan', async () => {
    // After _expireSubscription, getActiveSubscription returns null → FREE
    const expiredEndDate = new Date(Date.now() - 2 * 3600_000);
    const expiredSub = {
      ...makeActiveSub('PREMIUM'),
      end_date: expiredEndDate,
      grace_period_minutes: 60,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [expiredSub] }) // SELECT in getActiveSubscription
      .mockResolvedValueOnce({ rows: [] });           // UPDATE to EXPIRED

    const sub = await getActiveSubscription(PREMIUM_UUID);
    expect(sub).toBeNull();

    _resetSubscriptionCache();
    // Next getUserPlan call: no active sub found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUserPlan(PREMIUM_UUID)).toBe('FREE');
  });

  test('Duplicate incrementUsage rejected by atomic SQL (returns 0 rows)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // getUserPlan
      .mockResolvedValueOnce({ rows: [] })   // INSERT blocked → 0 rows
      .mockResolvedValueOnce({ rows: [{ current_value: 10 }] }) // getUsage for error
      .mockResolvedValueOnce({ rows: [] });  // getUserPlan for error
    await expect(incrementUsage(FREE_UUID, 'medicines_count')).rejects.toBeInstanceOf(UsageLimitError);
  });

  test('Core reminder features always return true even when plan cache is empty', async () => {
    // Simulate cache miss with empty matrix
    mockGetFeatureMatrix.mockResolvedValueOnce({ FREE: {}, PREMIUM: {}, FAMILY: {} });
    mockQuery.mockResolvedValue({ rows: [] }); // FREE plan
    // reminders is in UNGATED_FEATURES — bypasses matrix entirely
    expect(await isFeatureEnabled(FREE_UUID, 'reminders')).toBe(true);
  });

  test('Feature gate DB error defaults to false for non-reminder feature', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB down'));
    // getUserPlan catches and returns FREE, then matrix lookup proceeds
    // We need to also mock getFeatureMatrix to throw to trigger the catch in isFeatureEnabled
    mockGetFeatureMatrix.mockRejectedValueOnce(new Error('Cache DB error'));
    const result = await isFeatureEnabled(FREE_UUID, 'caregiver_access');
    expect(result).toBe(false);
  });

  test('Feature flag toggle: disabling a flag kills it for all plans', async () => {
    // Both FREE and PREMIUM have the feature in the plan, but flag is globally off
    const matrixWithFlagOff = {
      FREE: { ...FULL_FEATURE_MATRIX.FREE, basic_adherence: false },
      PREMIUM: { ...FULL_FEATURE_MATRIX.PREMIUM, basic_adherence: false },
      FAMILY: { ...FULL_FEATURE_MATRIX.FAMILY, basic_adherence: false },
    };
    mockGetFeatureMatrix.mockResolvedValue(matrixWithFlagOff);

    mockQuery.mockResolvedValue({ rows: [makeActiveSub('PREMIUM')] });
    expect(await isFeatureEnabled(PREMIUM_UUID, 'basic_adherence')).toBe(false);

    _resetSubscriptionCache();
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await isFeatureEnabled(FREE_UUID, 'basic_adherence')).toBe(false);
  });
});
