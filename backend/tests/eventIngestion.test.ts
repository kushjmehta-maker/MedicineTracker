import { AdherenceEventSchema, BatchIngestSchema, IngestRequestSchema } from '../src/services/eventIngestion/validators';

// ─────────────────────────────────────────────────────────────────────────────
// Event Ingestion — unit tests
//
// Tests the validation logic without any database connection.
// ─────────────────────────────────────────────────────────────────────────────

const VALID_EVENT = {
  user_id: '550e8400-e29b-41d4-a716-446655440000',
  dose_instance_id: '550e8400-e29b-41d4-a716-446655440001',
  medication_id: '550e8400-e29b-41d4-a716-446655440002',
  event_type: 'TAKEN' as const,
  scheduled_time_utc: '2024-01-01T08:00:00.000Z',
  action_time_utc: '2024-01-01T08:02:00.000Z',
  delay_seconds: 120,
  snooze_count: 0,
  device_tz: 'Asia/Kolkata',
  app_version: '1.0.0',
};

describe('AdherenceEventSchema', () => {
  describe('valid inputs', () => {
    test('accepts a fully populated event', () => {
      const result = AdherenceEventSchema.safeParse(VALID_EVENT);
      expect(result.success).toBe(true);
    });

    test('accepts event without optional fields', () => {
      const minimal = {
        user_id: VALID_EVENT.user_id,
        dose_instance_id: VALID_EVENT.dose_instance_id,
        event_type: 'TRIGGERED',
        action_time_utc: '2024-01-01T08:00:00.000Z',
      };
      const result = AdherenceEventSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    test('accepts all valid event_type values', () => {
      const types = ['TAKEN', 'SNOOZED', 'MISSED', 'TRIGGERED', 'SKIPPED'];
      for (const event_type of types) {
        const result = AdherenceEventSchema.safeParse({ ...VALID_EVENT, event_type });
        expect(result.success).toBe(true);
      }
    });

    test('accepts action_time_utc within 60s clock skew into the future', () => {
      const slightlyFuture = new Date(Date.now() + 30_000).toISOString();
      const result = AdherenceEventSchema.safeParse({
        ...VALID_EVENT,
        action_time_utc: slightlyFuture,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('field validation failures', () => {
    test('rejects invalid user_id UUID', () => {
      const result = AdherenceEventSchema.safeParse({
        ...VALID_EVENT,
        user_id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.user_id).toBeDefined();
    });

    test('rejects invalid event_type', () => {
      const result = AdherenceEventSchema.safeParse({
        ...VALID_EVENT,
        event_type: 'EATEN',
      });
      expect(result.success).toBe(false);
    });

    test('rejects malformed action_time_utc', () => {
      const result = AdherenceEventSchema.safeParse({
        ...VALID_EVENT,
        action_time_utc: 'not-a-date',
      });
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors.action_time_utc).toBeDefined();
    });

    test('rejects future action_time_utc beyond 60s skew', () => {
      const farFuture = new Date(Date.now() + 120_000).toISOString();
      const result = AdherenceEventSchema.safeParse({
        ...VALID_EVENT,
        action_time_utc: farFuture,
      });
      expect(result.success).toBe(false);
      const flat = result.error?.flatten();
      const allErrors = [
        ...(flat?.fieldErrors.action_time_utc ?? []),
        ...(flat?.formErrors ?? []),
      ].join(' ');
      expect(allErrors.toLowerCase()).toContain('future');
    });

    test('rejects negative dose_instance_id', () => {
      const result = AdherenceEventSchema.safeParse({
        ...VALID_EVENT,
        dose_instance_id: 'ZZZZZ',
      });
      expect(result.success).toBe(false);
    });

    test('rejects delay_seconds beyond 7-day window', () => {
      const result = AdherenceEventSchema.safeParse({
        ...VALID_EVENT,
        delay_seconds: 86400 * 8,
      });
      expect(result.success).toBe(false);
    });

    test('rejects snooze_count below 0', () => {
      const result = AdherenceEventSchema.safeParse({
        ...VALID_EVENT,
        snooze_count: -1,
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('BatchIngestSchema', () => {
  test('accepts an array of valid events', () => {
    const result = BatchIngestSchema.safeParse([VALID_EVENT, VALID_EVENT]);
    expect(result.success).toBe(true);
  });

  test('rejects empty array', () => {
    const result = BatchIngestSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  test('rejects array exceeding 500 events', () => {
    const bigBatch = Array.from({ length: 501 }, () => VALID_EVENT);
    const result = BatchIngestSchema.safeParse(bigBatch);
    expect(result.success).toBe(false);
    expect(result.error?.flatten().formErrors.join(' ')).toContain('500');
  });

  test('rejects array with one invalid event', () => {
    const result = BatchIngestSchema.safeParse([VALID_EVENT, { ...VALID_EVENT, event_type: 'BAD' }]);
    expect(result.success).toBe(false);
  });
});

describe('IngestRequestSchema — single-or-batch union', () => {
  test('accepts single event object', () => {
    const result = IngestRequestSchema.safeParse(VALID_EVENT);
    expect(result.success).toBe(true);
  });

  test('accepts batch array', () => {
    const result = IngestRequestSchema.safeParse([VALID_EVENT]);
    expect(result.success).toBe(true);
  });

  test('rejects null', () => {
    const result = IngestRequestSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});
