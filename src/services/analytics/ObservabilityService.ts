import { v4 as uuidv4 } from 'uuid';
import { AnalyticsEvent, ReminderLog } from '../../models';
import { saveReminderLog, getLogsForDose } from '../storage/StorageService';

// ─────────────────────────────────────────────────────────────────────────────
// ObservabilityService
//
// Append-only event log.  Every significant engine action writes a ReminderLog
// entry so the full dose lifecycle is auditable.
//
// In MVP all events are written to local storage and printed to console.
// The `flush()` method is the integration point for future backend sync.
// ─────────────────────────────────────────────────────────────────────────────

type FlushHandler = (logs: ReminderLog[]) => Promise<void>;

let _flushHandler: FlushHandler | null = null;
const _pendingFlush: ReminderLog[] = [];

/**
 * Register a backend flush handler (e.g. POST to your API).
 * Call this once during app startup once the user is authenticated.
 */
export function registerFlushHandler(handler: FlushHandler): void {
  _flushHandler = handler;
}

/**
 * Log an analytics event for a specific dose instance.
 */
export async function logEvent(
  eventType: AnalyticsEvent,
  doseInstanceId: string,
  medicationId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const log: ReminderLog = {
    id: uuidv4(),
    doseInstanceId,
    medicationId,
    eventType,
    timestamp: new Date().toISOString(),
    metadata,
  };

  // Persist locally first — this must not fail
  await saveReminderLog(log);

  // Queue for backend flush
  _pendingFlush.push(log);

  if (__DEV__) {
    console.log(
      `[ObservabilityService] ${eventType} | dose=${doseInstanceId} | med=${medicationId}`,
      metadata ?? '',
    );
  }
}

/**
 * Log an engine-level event (not tied to a specific dose, e.g. BOOT_RESCHEDULE).
 * Uses a synthetic doseInstanceId of 'engine'.
 */
export async function logEngineEvent(
  eventType: AnalyticsEvent,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logEvent(eventType, 'engine', 'engine', metadata);
}

/**
 * Flush all pending events to the backend.
 * Called on app foreground or periodic background sync.
 * Events remain in the local log regardless of whether flush succeeds.
 */
export async function flush(): Promise<void> {
  if (!_flushHandler || _pendingFlush.length === 0) return;

  const batch = _pendingFlush.splice(0, _pendingFlush.length);
  try {
    await _flushHandler(batch);
  } catch (error) {
    // Re-queue on failure — the logs are safely in local storage
    _pendingFlush.unshift(...batch);
    console.warn('[ObservabilityService] Flush failed, events re-queued.', error);
  }
}

/**
 * Retrieve the full audit trail for a single dose instance.
 */
export async function getAuditTrail(doseInstanceId: string): Promise<ReminderLog[]> {
  return getLogsForDose(doseInstanceId);
}
