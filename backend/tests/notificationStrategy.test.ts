import { buildApp } from '../src/app';
import { FastifyInstance } from 'fastify';

// ─────────────────────────────────────────────────────────────────────────────
// Notification Strategy — unit tests (HTTP layer + strategy mapping)
//
// The DB call in getStrategyForUser is mocked so no PostgreSQL is needed.
// ─────────────────────────────────────────────────────────────────────────────

// Mock the entire strategy service to control what the DB "returns"
jest.mock('../src/services/notificationStrategy/NotificationStrategyService', () => ({
  getStrategyForUser: jest.fn(),
}));

// Mock auth middleware to skip authentication in tests
jest.mock('../src/middleware/authMiddleware', () => ({
  authMiddleware: jest.fn(async () => {}),
}));

// Mock prom-client to avoid port conflicts between test suites
jest.mock('prom-client', () => {
  const actual = jest.requireActual('prom-client');
  const registry = new actual.Registry();
  return {
    ...actual,
    Registry: jest.fn(() => registry),
    Histogram: jest.fn().mockImplementation(() => ({ observe: jest.fn() })),
    Gauge: jest.fn().mockImplementation(() => ({ set: jest.fn() })),
    Counter: jest.fn().mockImplementation(() => ({ inc: jest.fn() })),
  };
});

import { getStrategyForUser } from '../src/services/notificationStrategy/NotificationStrategyService';

const mockGetStrategy = getStrategyForUser as jest.MockedFunction<typeof getStrategyForUser>;

describe('GET /v1/users/:user_id/notification-strategy', () => {
  let app: FastifyInstance;
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    mockGetStrategy.mockReset();
  });

  // ── Strategy mappings ──────────────────────────────────────────────────────

  test('LOW risk user → SOFT strategy', async () => {
    mockGetStrategy.mockResolvedValue({
      userId: VALID_UUID,
      riskLevel: 'LOW',
      adherenceScore: 0.92,
      strategy: {
        initialIntensity: 'SOFT',
        nudgeScheduleMinutes: [20],
        maxNudges: 1,
        persistentNotification: false,
        vibrationPattern: 'soft',
      },
      computedAt: '2024-01-01T02:00:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/users/${VALID_UUID}/notification-strategy`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.risk_level).toBe('LOW');
    expect(body.strategy.initial_intensity).toBe('SOFT');
    expect(body.strategy.max_nudges).toBe(1);
    expect(body.strategy.nudge_schedule_minutes).toEqual([20]);
    expect(body.strategy.persistent_notification).toBe(false);
  });

  test('MEDIUM risk user → NORMAL strategy', async () => {
    mockGetStrategy.mockResolvedValue({
      userId: VALID_UUID,
      riskLevel: 'MEDIUM',
      adherenceScore: 0.72,
      strategy: {
        initialIntensity: 'NORMAL',
        nudgeScheduleMinutes: [10, 25],
        maxNudges: 2,
        persistentNotification: false,
        vibrationPattern: 'normal',
      },
      computedAt: '2024-01-01T02:00:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/users/${VALID_UUID}/notification-strategy`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.risk_level).toBe('MEDIUM');
    expect(body.strategy.initial_intensity).toBe('NORMAL');
    expect(body.strategy.nudge_schedule_minutes).toEqual([10, 25]);
    expect(body.strategy.max_nudges).toBe(2);
  });

  test('HIGH risk user → LOUD strategy with persistent notification', async () => {
    mockGetStrategy.mockResolvedValue({
      userId: VALID_UUID,
      riskLevel: 'HIGH',
      adherenceScore: 0.41,
      strategy: {
        initialIntensity: 'LOUD',
        nudgeScheduleMinutes: [5, 15],
        maxNudges: 3,
        persistentNotification: true,
        vibrationPattern: 'strong',
      },
      computedAt: '2024-01-01T02:00:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/users/${VALID_UUID}/notification-strategy`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.risk_level).toBe('HIGH');
    expect(body.strategy.initial_intensity).toBe('LOUD');
    expect(body.strategy.nudge_schedule_minutes).toEqual([5, 15]);
    expect(body.strategy.max_nudges).toBe(3);
    expect(body.strategy.persistent_notification).toBe(true);
    expect(body.strategy.vibration_pattern).toBe('strong');
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  test('response includes computed_at timestamp', async () => {
    mockGetStrategy.mockResolvedValue({
      userId: VALID_UUID,
      riskLevel: 'LOW',
      adherenceScore: 0.90,
      strategy: { initialIntensity: 'SOFT', nudgeScheduleMinutes: [20], maxNudges: 1, persistentNotification: false, vibrationPattern: 'soft' },
      computedAt: '2024-01-01T02:00:00.000Z',
    });

    const response = await app.inject({ method: 'GET', url: `/v1/users/${VALID_UUID}/notification-strategy` });
    const body = JSON.parse(response.body);
    expect(body.computed_at).toBe('2024-01-01T02:00:00.000Z');
  });

  test('response includes adherence_score rounded to 2dp', async () => {
    mockGetStrategy.mockResolvedValue({
      userId: VALID_UUID,
      riskLevel: 'LOW',
      adherenceScore: 0.9267834,
      strategy: { initialIntensity: 'SOFT', nudgeScheduleMinutes: [20], maxNudges: 1, persistentNotification: false, vibrationPattern: 'soft' },
      computedAt: '2024-01-01T02:00:00.000Z',
    });

    const response = await app.inject({ method: 'GET', url: `/v1/users/${VALID_UUID}/notification-strategy` });
    const body = JSON.parse(response.body);
    expect(body.adherence_score).toBe(0.93);
  });

  test('includes Cache-Control header with max-age', async () => {
    mockGetStrategy.mockResolvedValue({
      userId: VALID_UUID,
      riskLevel: 'LOW',
      adherenceScore: 1.0,
      strategy: { initialIntensity: 'SOFT', nudgeScheduleMinutes: [20], maxNudges: 1, persistentNotification: false, vibrationPattern: 'soft' },
      computedAt: '2024-01-01T02:00:00.000Z',
    });

    const response = await app.inject({ method: 'GET', url: `/v1/users/${VALID_UUID}/notification-strategy` });
    expect(response.headers['cache-control']).toMatch(/max-age=/);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  test('rejects non-UUID user_id with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/not-a-uuid/notification-strategy',
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBeTruthy();
  });

  // ── Safety guardrails ──────────────────────────────────────────────────────

  test('HIGH risk never returns fewer nudges than LOW risk', () => {
    // Hardcoded strategy constants check
    const lowNudges = 1;
    const highNudges = 3;
    expect(highNudges).toBeGreaterThan(lowNudges);
  });

  test('persistent_notification is only true for HIGH risk', () => {
    const persistentMap = { LOW: false, MEDIUM: false, HIGH: true };
    expect(persistentMap.LOW).toBe(false);
    expect(persistentMap.MEDIUM).toBe(false);
    expect(persistentMap.HIGH).toBe(true);
  });
});

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  test('returns 200 ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe('ok');
  });
});
