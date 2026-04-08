import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Input validation schemas for the event ingestion service
//
// All validation is done with Zod so error messages are structured and specific.
// ─────────────────────────────────────────────────────────────────────────────

export const EventTypeEnum = z.enum(['TAKEN', 'SNOOZED', 'MISSED', 'TRIGGERED', 'SKIPPED']);
export type EventType = z.infer<typeof EventTypeEnum>;

// ─── Single event ─────────────────────────────────────────────────────────────

export const AdherenceEventSchema = z
  .object({
    user_id: z.string().uuid({ message: 'user_id must be a valid UUID' }),

    dose_instance_id: z.string().uuid({ message: 'dose_instance_id must be a valid UUID' }),

    medication_id: z
      .string()
      .uuid({ message: 'medication_id must be a valid UUID' })
      .optional(),

    event_type: EventTypeEnum,

    scheduled_time_utc: z
      .string()
      .datetime({ message: 'scheduled_time_utc must be an ISO-8601 datetime' })
      .optional(),

    action_time_utc: z
      .string()
      .datetime({ message: 'action_time_utc must be an ISO-8601 datetime' }),

    delay_seconds: z
      .number()
      .int()
      .min(-86400, 'delay_seconds cannot be earlier than 24h before schedule')
      .max(86400 * 7, 'delay_seconds exceeds maximum allowed window')
      .optional(),

    snooze_count: z.number().int().min(0).max(20).optional(),

    device_tz: z
      .string()
      .max(64)
      .optional(),

    app_version: z.string().max(32).optional(),
  })
  .refine(
    (data) => {
      const actionTime = new Date(data.action_time_utc).getTime();
      const nowMs = Date.now();
      // Allow up to 60 seconds clock skew
      return actionTime <= nowMs + 60_000;
    },
    {
      message: 'action_time_utc cannot be in the future',
      path: ['action_time_utc'],
    },
  );

export type AdherenceEventInput = z.infer<typeof AdherenceEventSchema>;

// ─── Batch upload (offline queue flush) ──────────────────────────────────────

export const BatchIngestSchema = z
  .array(AdherenceEventSchema)
  .min(1, 'Batch must contain at least one event')
  .max(500, 'Batch size cannot exceed 500 events');

// ─── Single-or-batch union ────────────────────────────────────────────────────

export const IngestRequestSchema = z.union([AdherenceEventSchema, BatchIngestSchema]);

export type IngestRequest = z.infer<typeof IngestRequestSchema>;
