import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  AndroidFullScreenAction,
  Event,
  EventType,
  TriggerType,
  TimestampTrigger,
} from '@notifee/react-native';
import { Medication, DoseInstance, NOTIFICATION_ACTION, EngineConfig } from '../../models';

// ─────────────────────────────────────────────────────────────────────────────
// NotificationService
//
// Thin wrapper around @notifee/react-native.
//
// Responsibilities:
//  • Schedule exact-alarm trigger notifications
//  • Cancel notifications
//  • Build rich Android notification payloads with actionable buttons
//  • Provide permission request helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Request notification + exact-alarm permissions.
 * Must be called before scheduling any notification.
 */
export async function requestPermissions(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  // On Android 13+ this prompts for POST_NOTIFICATIONS.
  // On Android 12+ exact alarms are requested separately.
  await notifee.openPowerManagerSettings(); // Hint user to disable battery opt
  return settings.authorizationStatus >= 1; // AUTHORIZED or PROVISIONAL
}

/**
 * Schedule a medicine-reminder notification using Notifee's TimestampTrigger
 * (backed by AlarmManager setExactAndAllowWhileIdle on Android ≥ 23).
 *
 * Returns the Notifee notification ID so it can be stored on the DoseInstance.
 */
export async function scheduleMedicineReminder(
  dose: DoseInstance,
  medication: Medication,
  config: EngineConfig,
): Promise<string> {
  const scheduledMs = new Date(dose.scheduledTimeUtc).getTime();
  const nowMs = Date.now();

  if (scheduledMs <= nowMs) {
    throw new Error(
      `Cannot schedule reminder in the past: ${dose.scheduledTimeUtc} for dose ${dose.id}`,
    );
  }

  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: scheduledMs,
    alarmManager: {
      allowWhileIdle: true, // Required to fire during Doze mode
    },
  };

  const notificationId = await notifee.createTriggerNotification(
    buildMedicinePayload(dose, medication, config),
    trigger,
  );

  return notificationId;
}

/**
 * Schedule a snooze reminder — same payload, different trigger time.
 */
export async function scheduleSnoozeReminder(
  dose: DoseInstance,
  medication: Medication,
  snoozeUntilMs: number,
  config: EngineConfig,
): Promise<string> {
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: snoozeUntilMs,
    alarmManager: { allowWhileIdle: true },
  };

  const notificationId = await notifee.createTriggerNotification(
    buildMedicinePayload(dose, medication, config, true),
    trigger,
  );

  return notificationId;
}

/**
 * Schedule a missed-dose nudge (lower priority, no DND bypass).
 */
export async function scheduleMissedDoseNudge(
  dose: DoseInstance,
  medication: Medication,
  config: EngineConfig,
): Promise<string> {
  // Fire immediately
  return notifee.displayNotification({
    id: `nudge_${dose.id}`,
    title: `Did you take ${medication.name}?`,
    body: `Your ${medication.dosage} dose was scheduled earlier. Please check.`,
    android: {
      channelId: config.nudgeChannelId,
      smallIcon: 'ic_notification',
      importance: AndroidImportance.DEFAULT,
      pressAction: { id: 'default' },
      actions: [
        { title: 'Taken', pressAction: { id: NOTIFICATION_ACTION.TAKEN, launchActivity: 'default' } },
        { title: 'Skip', pressAction: { id: NOTIFICATION_ACTION.SKIP } },
      ],
      data: { doseId: dose.id, medicationId: medication.id },
    } as never,
  });
}

/**
 * Cancel a previously scheduled or displayed notification.
 * Safe to call if the notification was already delivered or cancelled.
 */
export async function cancelNotification(notificationId: string): Promise<void> {
  await notifee.cancelNotification(notificationId);
}

/**
 * Cancel all notifications — used during boot reschedule or data wipe.
 */
export async function cancelAllNotifications(): Promise<void> {
  await notifee.cancelAllNotifications();
}

/**
 * Returns IDs of all pending trigger notifications (not yet delivered).
 */
export async function getPendingNotificationIds(): Promise<string[]> {
  const triggers = await notifee.getTriggerNotifications();
  return triggers
    .map((t) => t.notification.id)
    .filter((id): id is string => id !== undefined);
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

type ActionHandler = (event: Event) => Promise<void>;

let _backgroundHandler: ActionHandler | null = null;
let _foregroundHandler: ActionHandler | null = null;

export function setBackgroundEventHandler(handler: ActionHandler): void {
  _backgroundHandler = handler;
}

export function setForegroundEventHandler(handler: ActionHandler): void {
  _foregroundHandler = handler;
}

/**
 * Called from index.js — must be registered before the app component renders.
 */
export function registerBackgroundHandler(): void {
  notifee.onBackgroundEvent(async (event) => {
    if (_backgroundHandler) {
      await _backgroundHandler(event);
    }
  });
}

/**
 * Call inside a React component's useEffect to handle foreground events.
 * Returns unsubscribe function.
 */
export function registerForegroundHandler(): () => void {
  return notifee.onForegroundEvent((event) => {
    if (_foregroundHandler) {
      _foregroundHandler(event).catch(console.error);
    }
  });
}

// ─── Payload builder ─────────────────────────────────────────────────────────

function buildMedicinePayload(
  dose: DoseInstance,
  medication: Medication,
  config: EngineConfig,
  isSnoozed = false,
): Parameters<typeof notifee.createTriggerNotification>[0] {
  const scheduledLocal = new Date(dose.scheduledTimeUtc).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const title = isSnoozed
    ? `Reminder: ${medication.name}`
    : `Time to take ${medication.name}`;
  const body = `${medication.dosage} — scheduled at ${scheduledLocal}`;

  return {
    id: dose.id, // Use doseId as notification ID for 1:1 mapping
    title,
    body,
    android: {
      channelId: config.notificationChannelId,
      smallIcon: 'ic_notification',
      largeIcon: 'ic_medicine',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      category: AndroidCategory.ALARM,
      bypassDnd: true,
      autoCancel: false,       // Keep notification until user acts
      ongoing: false,
      fullScreenAction: {
        id: 'default',
        launchActivity: 'default',
        launchActivityFlags: [8], // FLAG_ACTIVITY_NEW_TASK
      } as AndroidFullScreenAction,
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        {
          title: '✓ Taken',
          pressAction: { id: NOTIFICATION_ACTION.TAKEN },
        },
        {
          title: '⏰ Snooze 10m',
          pressAction: { id: NOTIFICATION_ACTION.SNOOZE_10 },
        },
        {
          title: '✕ Skip',
          pressAction: { id: NOTIFICATION_ACTION.SKIP },
        },
      ],
      // Custom data carried through to background handler
      inputHistory: undefined,
    } as never,
    // Data payload for background handler
    data: {
      doseId: dose.id,
      medicationId: medication.id,
    },
  };
}
