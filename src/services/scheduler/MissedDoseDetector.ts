import { Medication, DoseInstance, DoseStatus } from '../../models';
import {
  getOverdueDoseInstances,
  getMedication,
  getEngineConfig,
} from '../storage/StorageService';
import { markMissed } from '../stateEngine/DoseStateEngine';
import { cancelNotification, scheduleMissedDoseNudge } from '../notifications/NotificationService';

// ─────────────────────────────────────────────────────────────────────────────
// MissedDoseDetector
//
// Scans for DoseInstances whose window has expired without user action.
//
// Run this:
//  • On app foreground (AppState 'active')
//  • After boot reschedule
//  • Optionally on a periodic background task (if platform permits)
//
// A dose is "overdue" when:
//   now > scheduledTimeUtc + missedDoseWindowMinutes
//
// For snoozed doses, the window extends from snoozedUntilUtc instead.
// ─────────────────────────────────────────────────────────────────────────────

export interface MissedDetectionResult {
  processed: number;
  marked: DoseInstance[];
  errors: { doseId: string; error: string }[];
}

/**
 * Detect and mark all overdue doses as MISSED.
 * Returns a summary of what was processed.
 */
export async function detectAndMarkMissedDoses(): Promise<MissedDetectionResult> {
  const cfg = await getEngineConfig();
  const nowUtc = new Date();
  const result: MissedDetectionResult = { processed: 0, marked: [], errors: [] };

  // Get all doses that are in an "active" state (not yet terminal)
  const overdueCandidates = await getOverdueDoseInstances(nowUtc);

  for (const dose of overdueCandidates) {
    result.processed++;

    try {
      const medication = await getMedication(dose.medicationId);
      if (!medication) continue;

      const windowMinutes =
        medication.missedDoseWindowMinutes ?? cfg.defaultMissedDoseWindowMinutes;

      // Determine the reference time for the window
      const refTimeUtc = dose.snoozedUntilUtc
        ? new Date(dose.snoozedUntilUtc)
        : new Date(dose.scheduledTimeUtc);

      const deadlineUtc = new Date(refTimeUtc.getTime() + windowMinutes * 60_000);

      if (nowUtc < deadlineUtc) {
        // Window hasn't expired yet — skip
        continue;
      }

      // Cancel the pending notification (if still in queue)
      if (dose.notificationId) {
        try {
          await cancelNotification(dose.notificationId);
        } catch {
          // Notification may have already fired — that's OK
        }
      }

      const missed = await markMissed(dose.id);
      result.marked.push(missed);

      // Send a gentle nudge notification (best-effort)
      try {
        await scheduleMissedDoseNudge(dose, medication, cfg);
      } catch {
        // Non-critical — don't fail the entire detection run
      }
    } catch (error) {
      result.errors.push({
        doseId: dose.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Check a single dose for missed status.
 * Used when the notification is dismissed without action (EventType.DISMISSED).
 */
export async function checkSingleDose(doseId: string): Promise<boolean> {
  const cfg = await getEngineConfig();
  const result = await detectAndMarkMissedDoses();
  return result.marked.some((d) => d.id === doseId);
}
