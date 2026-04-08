import {
  DoseInstance,
  DoseStatus,
  VALID_TRANSITIONS,
  AnalyticsEvent,
} from '../../models';
import { updateDoseInstance, getDoseInstance } from '../storage/StorageService';
import { logEvent } from '../analytics/ObservabilityService';

// ─────────────────────────────────────────────────────────────────────────────
// DoseStateEngine
//
// Enforces the dose state machine with atomic transitions.
// Every mutation goes through this service to prevent:
//  • Double marking (e.g. marking TAKEN twice)
//  • Invalid transitions (e.g. TAKEN → SNOOZED)
//  • Race conditions (optimistic check-then-act with re-read)
//
// State machine:
//   SCHEDULED → TRIGGERED → TAKEN       (terminal)
//                         → SNOOZED → TRIGGERED (loop)
//                         → SKIPPED     (terminal)
//                         → MISSED      (terminal)
//   SCHEDULED → MISSED    (when detection runs before trigger fires)
// ─────────────────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  constructor(from: DoseStatus, to: DoseStatus) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Transition a DoseInstance to a new status.
 * Re-reads from storage before applying the transition to prevent races.
 * Returns the updated DoseInstance.
 */
export async function transitionDose(
  doseId: string,
  toStatus: DoseStatus,
  extraFields?: Partial<DoseInstance>,
): Promise<DoseInstance> {
  // Re-read from storage (prevents acting on a stale in-memory copy)
  const dose = await getDoseInstance(doseId);
  if (!dose) {
    throw new Error(`DoseInstance not found: ${doseId}`);
  }

  const allowed = VALID_TRANSITIONS[dose.status];
  if (!allowed.includes(toStatus)) {
    throw new InvalidTransitionError(dose.status, toStatus);
  }

  const now = new Date().toISOString();
  const updated: DoseInstance = {
    ...dose,
    ...extraFields,
    status: toStatus,
    updatedAt: now,
  };

  await updateDoseInstance(updated);

  // Map status → analytics event
  const eventMap: Partial<Record<DoseStatus, AnalyticsEvent>> = {
    [DoseStatus.TRIGGERED]: AnalyticsEvent.REMINDER_DELIVERED,
    [DoseStatus.TAKEN]: AnalyticsEvent.DOSE_TAKEN,
    [DoseStatus.SNOOZED]: AnalyticsEvent.DOSE_SNOOZED,
    [DoseStatus.MISSED]: AnalyticsEvent.DOSE_MISSED,
    [DoseStatus.SKIPPED]: AnalyticsEvent.DOSE_SKIPPED,
  };

  const event = eventMap[toStatus];
  if (event) {
    await logEvent(event, doseId, dose.medicationId, {
      from: dose.status,
      to: toStatus,
    });
  }

  return updated;
}

/**
 * Mark dose as TRIGGERED (notification fired).
 */
export async function markTriggered(doseId: string): Promise<DoseInstance> {
  return transitionDose(doseId, DoseStatus.TRIGGERED);
}

/**
 * Mark dose as TAKEN.
 */
export async function markTaken(doseId: string): Promise<DoseInstance> {
  return transitionDose(doseId, DoseStatus.TAKEN, {
    takenAt: new Date().toISOString(),
  });
}

/**
 * Mark dose as SKIPPED.
 */
export async function markSkipped(doseId: string): Promise<DoseInstance> {
  return transitionDose(doseId, DoseStatus.SKIPPED, {
    skippedAt: new Date().toISOString(),
  });
}

/**
 * Mark dose as MISSED.
 */
export async function markMissed(doseId: string): Promise<DoseInstance> {
  return transitionDose(doseId, DoseStatus.MISSED, {
    missedAt: new Date().toISOString(),
  });
}

/**
 * Mark dose as SNOOZED.  The SnoozeManager calls this and also sets
 * snoozedUntilUtc and increments snoozeCount.
 */
export async function markSnoozed(
  doseId: string,
  snoozedUntilUtc: string,
  snoozeCount: number,
  newNotificationId: string,
): Promise<DoseInstance> {
  return transitionDose(doseId, DoseStatus.SNOOZED, {
    snoozedUntilUtc,
    snoozeCount,
    notificationId: newNotificationId,
  });
}

/**
 * Mark dose back to TRIGGERED after snooze fires.
 */
export async function markSnoozeTriggered(doseId: string): Promise<DoseInstance> {
  return transitionDose(doseId, DoseStatus.TRIGGERED);
}
