import { v4 as uuidv4 } from 'uuid';
import {
  addDays,
  parseISO,
  isAfter,
  isBefore,
  startOfDay,
  endOfDay,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
} from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import {
  Medication,
  DoseInstance,
  DoseStatus,
  EngineConfig,
  AnalyticsEvent,
} from '../../models';
import {
  saveDoseInstance,
  getDosesForMedication,
  getEngineConfig,
} from '../storage/StorageService';
import {
  scheduleMedicineReminder,
  cancelNotification,
} from '../notifications/NotificationService';
import { logEvent } from '../analytics/ObservabilityService';

// ─────────────────────────────────────────────────────────────────────────────
// ReminderScheduler
//
// Generates DoseInstance records and schedules Notifee alarms for a medication.
//
// Strategy:
//  1. Compute the window: today → today + precomputeDaysAhead
//  2. For each day in the window, for each scheduleTime on the medication:
//     a. Build the UTC timestamp for that slot
//     b. Skip if already past or a DoseInstance already exists for that slot
//     c. Create DoseInstance in SCHEDULED state
//     d. Schedule Notifee TimestampTrigger notification
//     e. Persist notificationId back onto DoseInstance
//
// Idempotent: re-running for the same medication will not create duplicates
// because we check existing DoseInstances before creating a new one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule all future reminders for a medication.
 * Safe to call on add, update, or after boot reschedule.
 */
export async function scheduleMedicationReminders(
  medication: Medication,
  timezone: string,
  config?: EngineConfig,
): Promise<DoseInstance[]> {
  const cfg = config ?? (await getEngineConfig());

  if (!medication.isActive) return [];

  const nowUtc = new Date();
  const windowEnd = addDays(nowUtc, cfg.precomputeDaysAhead);
  const startDateUtc = parseISO(medication.startDate + 'T00:00:00Z');
  const endDateUtc = medication.endDate
    ? parseISO(medication.endDate + 'T23:59:59Z')
    : null;

  // Load existing doses to prevent duplicates
  const existingDoses = await getDosesForMedication(medication.id);
  const existingSlots = new Set(existingDoses.map((d) => d.scheduledTimeUtc));

  const scheduled: DoseInstance[] = [];

  // Iterate over each day in the compute window
  let cursor = startOfDay(
    isAfter(startDateUtc, nowUtc) ? startDateUtc : nowUtc,
  );

  while (isBefore(cursor, windowEnd)) {
    if (endDateUtc && isAfter(cursor, endDateUtc)) break;

    for (const slot of medication.scheduleTimes) {
      // Build the wall-clock datetime in the user's local timezone
      const localDateTime = setMilliseconds(
        setSeconds(
          setMinutes(setHours(toZonedTime(cursor, timezone), slot.hour), slot.minute),
          0,
        ),
        0,
      );

      // Convert to UTC
      const utcDateTime = fromZonedTime(localDateTime, timezone);
      const utcIso = utcDateTime.toISOString();

      // Skip past reminders and duplicates
      if (!isAfter(utcDateTime, nowUtc)) continue;
      if (existingSlots.has(utcIso)) continue;

      // Create dose instance
      const dose: DoseInstance = {
        id: uuidv4(),
        medicationId: medication.id,
        scheduledTimeUtc: utcIso,
        status: DoseStatus.SCHEDULED,
        snoozeCount: 0,
        createdAt: nowUtc.toISOString(),
        updatedAt: nowUtc.toISOString(),
      };

      // Persist first, then schedule the alarm
      await saveDoseInstance(dose);
      existingSlots.add(utcIso);

      try {
        const notificationId = await scheduleMedicineReminder(dose, medication, cfg);
        dose.notificationId = notificationId;
        dose.updatedAt = new Date().toISOString();
        await saveDoseInstance(dose);

        await logEvent(AnalyticsEvent.REMINDER_SCHEDULED, dose.id, medication.id, {
          scheduledTimeUtc: utcIso,
          timezone,
        });
      } catch (err) {
        // Log but don't crash — the DoseInstance is persisted; we can retry
        console.error(
          `[ReminderScheduler] Failed to schedule notification for dose ${dose.id}`,
          err,
        );
      }

      scheduled.push(dose);
    }

    cursor = addDays(cursor, 1);
  }

  return scheduled;
}

/**
 * Cancel all pending notifications for a medication and remove future
 * SCHEDULED DoseInstances.  Called when a medication is deactivated or deleted.
 */
export async function cancelMedicationReminders(medication: Medication): Promise<void> {
  const doses = await getDosesForMedication(medication.id);
  const toCancel = doses.filter((d) => d.status === DoseStatus.SCHEDULED);

  await Promise.all(
    toCancel.map(async (d) => {
      if (d.notificationId) {
        await cancelNotification(d.notificationId);
      }
    }),
  );
}

/**
 * Reschedule a medication from scratch.
 * Use when the schedule itself changes (times, start/end date, etc.).
 */
export async function rescheduleMedication(
  medication: Medication,
  timezone: string,
  config?: EngineConfig,
): Promise<DoseInstance[]> {
  await cancelMedicationReminders(medication);
  return scheduleMedicationReminders(medication, timezone, config);
}

/**
 * Extend the scheduling window for all active medications.
 * Called daily (or on app open) to ensure the look-ahead window is always full.
 */
export async function extendSchedulingWindow(
  medications: Medication[],
  timezone: string,
  config?: EngineConfig,
): Promise<void> {
  await Promise.all(
    medications
      .filter((m) => m.isActive)
      .map((m) => scheduleMedicationReminders(m, timezone, config)),
  );
}
