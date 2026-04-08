import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AndroidCategory,
} from '@notifee/react-native';
import { EngineConfig } from '../../models';

// ─────────────────────────────────────────────────────────────────────────────
// NotificationChannels
//
// Defines Android notification channels.  Must be created before any
// notification is displayed.  Idempotent — safe to call on every startup.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create all required notification channels.
 * On iOS this is a no-op (channels are Android-only).
 */
export async function createNotificationChannels(config: EngineConfig): Promise<void> {
  // Critical medicine reminder channel — max importance, always shows on lock screen
  await notifee.createChannel({
    id: config.notificationChannelId,
    name: 'Medicine Reminders',
    description: 'Critical reminders to take your medication on time.',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,  // Show on lock screen
    vibration: true,
    vibrationPattern: [300, 500, 300, 500],
    sound: 'default',
    bypassDnd: true,   // Break through Do Not Disturb for medication safety
    lights: true,
    lightColor: '#FF0000',
    badge: true,
  });

  // Missed-dose nudge channel — lower urgency, no DND bypass
  await notifee.createChannel({
    id: config.nudgeChannelId,
    name: 'Missed Dose Nudge',
    description: 'Gentle reminders when a dose window has passed.',
    importance: AndroidImportance.DEFAULT,
    visibility: AndroidVisibility.PUBLIC,
    vibration: true,
    sound: 'default',
    badge: true,
  });

  // Doctor follow-up / appointment channel
  await notifee.createChannel({
    id: config.followUpChannelId,
    name: 'Doctor Follow-Ups',
    description: 'Reminders for upcoming doctor appointments and lab tests.',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    vibration: true,
    sound: 'default',
    badge: true,
  });
}
