import { Event, EventType } from '@notifee/react-native';
import {
  Medication,
  DoseInstance,
  FollowUpReminder,
  EngineConfig,
  DEFAULT_ENGINE_CONFIG,
  AnalyticsEvent,
  NOTIFICATION_ACTION,
  AdherenceSummary,
} from './models';
import {
  saveMedication,
  getMedication,
  getActiveMedications,
  deleteMedication,
  getDoseInstance,
  deleteDoseInstancesForMedication,
  saveEngineConfig,
  getEngineConfig,
  getLastKnownTimezone,
  saveLastKnownTimezone,
} from './services/storage/StorageService';
import { createNotificationChannels } from './services/notifications/NotificationChannels';
import {
  requestPermissions,
  cancelNotification,
  registerBackgroundHandler,
  registerForegroundHandler,
  setBackgroundEventHandler,
  setForegroundEventHandler,
} from './services/notifications/NotificationService';
import {
  scheduleMedicationReminders,
  cancelMedicationReminders,
  rescheduleMedication,
  extendSchedulingWindow,
} from './services/scheduler/ReminderScheduler';
import { snoozeDose, canSnooze } from './services/scheduler/SnoozeManager';
import { detectAndMarkMissedDoses, MissedDetectionResult } from './services/scheduler/MissedDoseDetector';
import {
  markTaken,
  markSkipped,
  markTriggered,
} from './services/stateEngine/DoseStateEngine';
import { calculateAdherence, getRecentAdherence } from './services/stateEngine/AdherenceCalculator';
import { rescheduleAfterBoot, BootRescheduleResult } from './services/boot/BootRescheduler';
import { checkAndHandleTimezoneChange, TimezoneChangeResult } from './services/timezone/TimezoneHandler';
import {
  scheduleFollowUp,
  completeFollowUp,
  removeFollowUp,
  getUpcomingFollowUps,
} from './services/followup/FollowUpReminderService';
import { logEvent, logEngineEvent, flush as flushAnalytics } from './services/analytics/ObservabilityService';

// ─────────────────────────────────────────────────────────────────────────────
// NotificationEngine
//
// The single public facade for the entire notification/reminder system.
// All consumers (UI, background tasks, native modules) interact through here.
//
// Lifecycle:
//   1. Call NotificationEngine.initialize() once at app startup
//   2. Call onAppForeground() every time the app becomes active
//   3. Call handleBootComplete() from the native BootReceiver bridge
//   4. Use the medication CRUD methods to manage reminders
// ─────────────────────────────────────────────────────────────────────────────

export class NotificationEngine {
  private static _instance: NotificationEngine | null = null;
  private _initialized = false;
  private _currentTimezone = 'UTC';

  private constructor() {}

  static getInstance(): NotificationEngine {
    if (!NotificationEngine._instance) {
      NotificationEngine._instance = new NotificationEngine();
    }
    return NotificationEngine._instance;
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  /**
   * Must be called once at app startup (before rendering any UI).
   */
  async initialize(timezone: string): Promise<void> {
    if (this._initialized) return;

    this._currentTimezone = timezone;

    const config = await getEngineConfig();
    await saveEngineConfig(config); // Ensure config is persisted

    // Set up Android notification channels
    await createNotificationChannels(config);

    // Request permissions (prompts user on first run)
    await requestPermissions();

    // Wire up background event handler (notification action buttons)
    setBackgroundEventHandler(this._handleNotificationEvent.bind(this));
    setForegroundEventHandler(this._handleNotificationEvent.bind(this));

    // Persist timezone baseline
    const storedTz = await getLastKnownTimezone();
    if (!storedTz) {
      await saveLastKnownTimezone(timezone);
    }

    await logEngineEvent(AnalyticsEvent.ENGINE_INITIALIZED, { timezone });
    this._initialized = true;
  }

  // ─── App lifecycle hooks ─────────────────────────────────────────────────────

  /**
   * Call every time the app becomes active (AppState 'active').
   * Handles: timezone detection, missed dose sweep, schedule extension.
   */
  async onAppForeground(currentTimezone: string): Promise<void> {
    this._currentTimezone = currentTimezone;

    // Detect and handle timezone change
    await checkAndHandleTimezoneChange(currentTimezone);

    // Mark any doses whose window elapsed while app was in background
    await detectAndMarkMissedDoses();

    // Extend the scheduling look-ahead window
    const medications = await getActiveMedications();
    await extendSchedulingWindow(medications, currentTimezone, await getEngineConfig());

    // Flush analytics to backend (best-effort)
    await flushAnalytics();
  }

  /**
   * Called from the Android BootReceiver native bridge after device reboot.
   */
  async handleBootComplete(currentTimezone: string): Promise<BootRescheduleResult> {
    this._currentTimezone = currentTimezone;
    return rescheduleAfterBoot(currentTimezone);
  }

  // ─── Medication CRUD ──────────────────────────────────────────────────────────

  /**
   * Add a new medication and immediately schedule its reminders.
   */
  async addMedication(medication: Medication): Promise<DoseInstance[]> {
    await saveMedication(medication);
    const doses = await scheduleMedicationReminders(
      medication,
      this._currentTimezone,
      await getEngineConfig(),
    );
    return doses;
  }

  /**
   * Update medication details and reschedule all future reminders.
   */
  async updateMedication(medication: Medication): Promise<DoseInstance[]> {
    medication.updatedAt = new Date().toISOString();
    await saveMedication(medication);
    return rescheduleMedication(medication, this._currentTimezone, await getEngineConfig());
  }

  /**
   * Deactivate a medication: cancel pending alarms and mark inactive.
   */
  async deactivateMedication(medicationId: string): Promise<void> {
    const med = await getMedication(medicationId);
    if (!med) throw new Error(`Medication not found: ${medicationId}`);
    await cancelMedicationReminders(med);
    med.isActive = false;
    med.updatedAt = new Date().toISOString();
    await saveMedication(med);
  }

  /**
   * Permanently delete a medication and all its dose history.
   */
  async deleteMedication(medicationId: string): Promise<void> {
    const med = await getMedication(medicationId);
    if (med) {
      await cancelMedicationReminders(med);
      await deleteDoseInstancesForMedication(medicationId);
    }
    await deleteMedication(medicationId);
  }

  // ─── Dose actions ─────────────────────────────────────────────────────────────

  async markDoseTaken(doseId: string): Promise<DoseInstance> {
    const dose = await getDoseInstance(doseId);
    if (dose?.notificationId) {
      await cancelNotification(dose.notificationId).catch(() => {});
    }
    return markTaken(doseId);
  }

  async skipDose(doseId: string): Promise<DoseInstance> {
    const dose = await getDoseInstance(doseId);
    if (dose?.notificationId) {
      await cancelNotification(dose.notificationId).catch(() => {});
    }
    return markSkipped(doseId);
  }

  async snoozeDose(doseId: string, minutes: number): Promise<DoseInstance> {
    return snoozeDose(doseId, minutes, await getEngineConfig());
  }

  async canSnoozeDose(doseId: string): Promise<boolean> {
    return canSnooze(doseId, await getEngineConfig());
  }

  // ─── Missed dose detection ────────────────────────────────────────────────────

  async detectMissedDoses(): Promise<MissedDetectionResult> {
    return detectAndMarkMissedDoses();
  }

  // ─── Adherence ────────────────────────────────────────────────────────────────

  async getAdherence(
    medicationId: string,
    fromDate: string,
    toDate: string,
  ): Promise<AdherenceSummary> {
    return calculateAdherence(medicationId, fromDate, toDate);
  }

  async getRecentAdherence(medicationId: string, days = 7): Promise<number> {
    return getRecentAdherence(medicationId, days);
  }

  // ─── Follow-up reminders ──────────────────────────────────────────────────────

  async addFollowUp(
    title: string,
    appointmentDateUtc: string,
    description?: string,
  ): Promise<FollowUpReminder> {
    return scheduleFollowUp(title, appointmentDateUtc, description, await getEngineConfig());
  }

  async completeFollowUp(reminderId: string): Promise<void> {
    return completeFollowUp(reminderId);
  }

  async removeFollowUp(reminderId: string): Promise<void> {
    return removeFollowUp(reminderId);
  }

  async getUpcomingFollowUps(): Promise<FollowUpReminder[]> {
    return getUpcomingFollowUps();
  }

  // ─── Config ───────────────────────────────────────────────────────────────────

  async updateConfig(config: Partial<EngineConfig>): Promise<void> {
    const current = await getEngineConfig();
    await saveEngineConfig({ ...current, ...config });
  }

  // ─── Notification event routing ───────────────────────────────────────────────

  /**
   * Handles both foreground and background notification events.
   * Routes PRESS_ACTION events to the appropriate dose action.
   */
  private async _handleNotificationEvent(event: Event): Promise<void> {
    const { type, detail } = event;

    // Only handle action presses
    if (type !== EventType.ACTION_PRESS && type !== EventType.PRESS) return;

    const doseId = detail.notification?.data?.doseId as string | undefined;
    const actionId = detail.pressAction?.id;

    if (!doseId) {
      // Could be a follow-up notification
      await logEngineEvent(AnalyticsEvent.REMINDER_OPENED, {
        notificationId: detail.notification?.id,
        actionId,
      });
      return;
    }

    await logEvent(AnalyticsEvent.REMINDER_OPENED, doseId,
      (detail.notification?.data?.medicationId as string) ?? 'unknown',
      { actionId });

    try {
      switch (actionId) {
        case NOTIFICATION_ACTION.TAKEN:
          await this.markDoseTaken(doseId);
          break;

        case NOTIFICATION_ACTION.SKIP:
          await this.skipDose(doseId);
          break;

        case NOTIFICATION_ACTION.SNOOZE_5:
          await this.snoozeDose(doseId, 5);
          break;

        case NOTIFICATION_ACTION.SNOOZE_10:
          await this.snoozeDose(doseId, 10);
          break;

        case NOTIFICATION_ACTION.SNOOZE_30:
          await this.snoozeDose(doseId, 30);
          break;

        default:
          // Notification tapped (no action button) — mark as triggered
          await markTriggered(doseId);
          break;
      }
    } catch (err) {
      console.error(`[NotificationEngine] Event handling failed for dose ${doseId}:`, err);
    }
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const notificationEngine = NotificationEngine.getInstance();
