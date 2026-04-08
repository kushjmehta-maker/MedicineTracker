import { getActiveMedications, getEngineConfig, getLastKnownTimezone, saveLastKnownTimezone } from '../storage/StorageService';
import { cancelAllNotifications } from '../notifications/NotificationService';
import { rescheduleMedication } from '../scheduler/ReminderScheduler';
import { logEngineEvent } from '../analytics/ObservabilityService';
import { AnalyticsEvent } from '../../models';

// ─────────────────────────────────────────────────────────────────────────────
// TimezoneHandler
//
// Called when the device timezone changes (e.g. travel, DST, manual change).
//
// Problem: medicine schedule times are entered in the user's LOCAL timezone
// (e.g. "take at 8:00 AM").  When the timezone changes, "8:00 AM" is now a
// different UTC moment.  All future alarms must be recalculated.
//
// Strategy:
//   1. Detect timezone change by comparing stored timezone with current
//   2. Cancel all pending notifications
//   3. Recompute future dose times against the NEW timezone
//   4. Reschedule alarms
//   5. Update stored timezone
//
// When to call checkAndHandleTimezoneChange():
//   • On every app foreground (AppState 'active')
//   • On device locale-change event (if available via NativeEventEmitter)
// ─────────────────────────────────────────────────────────────────────────────

export interface TimezoneChangeResult {
  previousTimezone: string;
  newTimezone: string;
  medicationsRescheduled: number;
  dosesScheduled: number;
}

/**
 * Detect timezone change and reschedule if needed.
 * Pass the current IANA timezone string (e.g. "Asia/Kolkata").
 * Returns null if no timezone change was detected.
 */
export async function checkAndHandleTimezoneChange(
  currentTimezone: string,
): Promise<TimezoneChangeResult | null> {
  const storedTimezone = await getLastKnownTimezone();

  if (storedTimezone === currentTimezone) {
    return null; // No change
  }

  const previous = storedTimezone ?? 'unknown';
  return handleTimezoneChange(previous, currentTimezone);
}

/**
 * Force a full reschedule for a specific timezone change.
 * Use this when you already know the timezone changed.
 */
export async function handleTimezoneChange(
  previousTimezone: string,
  newTimezone: string,
): Promise<TimezoneChangeResult> {
  const cfg = await getEngineConfig();
  const medications = await getActiveMedications();

  // Cancel all pending alarms — they're bound to the old timezone
  await cancelAllNotifications();

  let dosesScheduled = 0;
  for (const med of medications) {
    try {
      const doses = await rescheduleMedication(med, newTimezone, cfg);
      dosesScheduled += doses.length;
    } catch (err) {
      console.error(
        `[TimezoneHandler] Failed to reschedule ${med.name} for new timezone ${newTimezone}:`,
        err,
      );
    }
  }

  // Persist the new timezone
  await saveLastKnownTimezone(newTimezone);

  await logEngineEvent(AnalyticsEvent.TIMEZONE_CHANGE, {
    previousTimezone,
    newTimezone,
    medicationsRescheduled: medications.length,
    dosesScheduled,
  });

  return {
    previousTimezone,
    newTimezone,
    medicationsRescheduled: medications.length,
    dosesScheduled,
  };
}
