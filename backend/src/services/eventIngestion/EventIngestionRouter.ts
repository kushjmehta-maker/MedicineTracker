import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  IngestRequestSchema,
  AdherenceEventInput,
} from './validators';
import { ingestEvents } from './EventIngestionService';
import { ingestionLog } from '../../observability/logger';
import { adherenceEventCounter } from '../../observability/metrics';

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/adherence/events
//
// Accepts either:
//   • A single event object
//   • An array of events (batch/offline upload, max 500)
//
// Returns 200 even if all events were duplicates — the client should treat 200
// as "server acknowledged the payload".  Duplication counts are returned in the
// body so the client can confirm.
//
// Returns 422 on schema validation failure (wrong enum, future timestamp, etc.)
// Returns 500 on unexpected database error.
// ─────────────────────────────────────────────────────────────────────────────

export async function registerEventIngestionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/adherence/events', async (request: FastifyRequest, reply: FastifyReply) => {
    // ── 1. Validate ──────────────────────────────────────────────────────────
    let events: AdherenceEventInput[];

    const parsed = IngestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      adherenceEventCounter.inc({ outcome: 'rejected' });
      ingestionLog.warn({ errors: parsed.error.flatten() }, 'Validation rejected');
      return reply.status(422).send({
        error: 'Validation failed',
        details: formatZodError(parsed.error),
      });
    }

    events = Array.isArray(parsed.data)
      ? (parsed.data as AdherenceEventInput[])
      : [parsed.data as AdherenceEventInput];

    // ── 2. Ingest ─────────────────────────────────────────────────────────────
    const result = await ingestEvents(events);

    // ── 3. Respond ────────────────────────────────────────────────────────────
    return reply.status(200).send({
      received: events.length,
      inserted: result.inserted,
      duplicate: result.duplicate,
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatZodError(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_root';
    out[key] = [...(out[key] ?? []), issue.message];
  }
  return out;
}
