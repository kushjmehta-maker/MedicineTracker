import {
  Medication,
  DoseInstance,
  EngineConfig,
  AnalyticsEvent,
} from '../../models';
import { getDoseInstance, getMedication, getEngineConfig } from '../storage/StorageService';
import { cancelNotification, scheduleSnoozeReminder } from '../notifications/NotificationService';
import { markSnoozed } from '../stateEngine/DoseStateEngine';
import { logEvent } from '../analytics/ObservabilityService';

// ─────────────────────────────────────────────────────────────────────────────
// SnoozeManager
//
// Handles the full snooze lifecycle:
//   1. Validate snooze is allowed (not exceeded maxSnoozeCount)
//   2. Cancel the current alarm
//   3. Schedule a new alarm at now + snoozeMinutes
//   4. Transition dose to SNOOZED via DoseStateEngine
//
// The SNOOZED → TRIGGERED transition is handled by NotificationService when
// the snooze alarm fires (same background event handler flow).
// ─────────────────────────────────────────────────────────────────────────────

export class MaxSnoozeExceededError extends Error {
  constructor(doseId: string, max: number) {
    super(`Snooze limit (${max}) reached for dose ${doseId}`);
    this.name = 'MaxSnoozeExceededError';
  }
}

/**
 * Snooze a dose by the given number of minutes.
 * Returns the updated DoseInstance.
 */
export async function snoozeDose(
  doseId: string,
  snoozeMinutes: number,
  config?: EngineConfig,
): Promise<DoseInstance> {
  const cfg = config ?? (await getEngineConfig());
  const dose = await getDoseInstance(doseId);

  if (!dose) throw new Error(`DoseInstance not found: ${doseId}`);

  const medication = await getMedication(dose.medicationId);
  if (!medication) throw new Error(`Medication not found: ${dose.medicationId}`);

  // Enforce snooze cap
  const maxSnooze = medication.maxSnoozeCount ?? cfg.defaultMaxSnoozeCount;
  if (dose.snoozeCount >= maxSnooze) {
    throw new MaxSnoozeExceededError(doseId, maxSnooze);
  }

  // Cancel the current notification (so it doesn't re-fire)
  if (dose.notificationId) {
    await cancelNotification(dose.notificationId);
  }

  const snoozeUntilMs = Date.now() + snoozeMinutes * 60_000;
  const snoozeUntilUtc = new Date(snoozeUntilMs).toISOString();

  // Schedule the snooze alarm
  const newNotificationId = await scheduleSnoozeReminder(
    dose,
    medication,
    snoozeUntilMs,
    cfg,
  );

  // Atomically transition state
  const updated = await markSnoozed(
    doseId,
    snoozeUntilUtc,
    dose.snoozeCount + 1,
    newNotificationId,
  );

  await logEvent(AnalyticsEvent.DOSE_SNOOZED, doseId, medication.id, {
    snoozeMinutes,
    snoozeCount: updated.snoozeCount,
    snoozeUntilUtc,
  });

  return updated;
}

/**
 * Validate whether a dose can still be snoozed.
 * Useful for UI to disable the snooze button when the cap is reached.
 */
export async function canSnooze(doseId: string, config?: EngineConfig): Promise<boolean> {
  const cfg = config ?? (await getEngineConfig());
  const dose = await getDoseInstance(doseId);
  if (!dose) return false;

  const medication = await getMedication(dose.medicationId);
  if (!medication) return false;

  const maxSnooze = medication.maxSnoozeCount ?? cfg.defaultMaxSnoozeCount;
  return dose.snoozeCount < maxSnooze;
}
