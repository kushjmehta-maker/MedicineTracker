import { getActiveMedications, getEngineConfig, getLastKnownTimezone } from '../storage/StorageService';
import { cancelAllNotifications } from '../notifications/NotificationService';
import { scheduleMedicationReminders } from '../scheduler/ReminderScheduler';
import { detectAndMarkMissedDoses } from '../scheduler/MissedDoseDetector';
import { logEngineEvent } from '../analytics/ObservabilityService';
import { AnalyticsEvent } from '../../models';

// ─────────────────────────────────────────────────────────────────────────────
// BootRescheduler
//
// After a device reboot, ALL scheduled AlarmManager alarms are wiped by the OS.
// This service is called from:
//   • Android BootReceiver (via NativeModule bridge)
//   • App startup (in case the bridge fires before the JS bundle)
//
// Sequence:
//   1. Cancel any stale notifications still in Notifee's internal state
//   2. Reload all active medications from storage
//   3. Reschedule future dose alarms
//   4. Run missed dose detection for any windows that elapsed while device was off
//   5. Log a BOOT_RESCHEDULE analytics event
// ─────────────────────────────────────────────────────────────────────────────

let _isRescheduling = false;

export interface BootRescheduleResult {
  medicationsProcessed: number;
  dosesScheduled: number;
  missedMarked: number;
  timezone: string;
  durationMs: number;
}

export async function rescheduleAfterBoot(
  currentTimezone: string,
): Promise<BootRescheduleResult> {
  // Debounce — prevent duplicate runs if bridge fires twice
  if (_isRescheduling) {
    return { medicationsProcessed: 0, dosesScheduled: 0, missedMarked: 0, timezone: currentTimezone, durationMs: 0 };
  }
  _isRescheduling = true;

  const startMs = Date.now();

  try {
    const cfg = await getEngineConfig();
    const medications = await getActiveMedications();

    // Step 1: Wipe all Notifee state (alarms are gone after reboot anyway)
    await cancelAllNotifications();

    // Step 2: Reschedule each active medication
    let dosesScheduled = 0;
    for (const med of medications) {
      try {
        const doses = await scheduleMedicationReminders(med, currentTimezone, cfg);
        dosesScheduled += doses.length;
      } catch (err) {
        console.error(`[BootRescheduler] Failed to reschedule ${med.name}:`, err);
      }
    }

    // Step 3: Detect doses that were missed while the device was off
    const missedResult = await detectAndMarkMissedDoses();

    const durationMs = Date.now() - startMs;

    await logEngineEvent(AnalyticsEvent.BOOT_RESCHEDULE, {
      medicationsProcessed: medications.length,
      dosesScheduled,
      missedMarked: missedResult.marked.length,
      timezone: currentTimezone,
      durationMs,
    });

    return {
      medicationsProcessed: medications.length,
      dosesScheduled,
      missedMarked: missedResult.marked.length,
      timezone: currentTimezone,
      durationMs,
    };
  } finally {
    _isRescheduling = false;
  }
}
