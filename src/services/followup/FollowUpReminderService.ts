import { v4 as uuidv4 } from 'uuid';
import { subHours } from 'date-fns';
import { FollowUpReminder, EngineConfig, AnalyticsEvent } from '../../models';
import {
  saveFollowUp,
  getFollowUp,
  getAllFollowUps,
  deleteFollowUp,
  getEngineConfig,
} from '../storage/StorageService';
import { cancelNotification } from '../notifications/NotificationService';
import notifee, { TriggerType, TimestampTrigger, AndroidImportance } from '@notifee/react-native';
import { logEngineEvent } from '../analytics/ObservabilityService';

// ─────────────────────────────────────────────────────────────────────────────
// FollowUpReminderService
//
// Manages doctor appointments and lab-test follow-up reminders.
//
// For each appointment at time T, two notifications are scheduled:
//   • T-24h  — "Your appointment is tomorrow"
//   • T-3h   — "Your appointment is today at [time]" (same-day reminder)
//
// Both notifications are cancelled when the follow-up is marked complete.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule a new follow-up reminder.
 */
export async function scheduleFollowUp(
  title: string,
  appointmentDateUtc: string,
  description?: string,
  config?: EngineConfig,
): Promise<FollowUpReminder> {
  const cfg = config ?? (await getEngineConfig());
  const appointmentMs = new Date(appointmentDateUtc).getTime();
  const nowMs = Date.now();

  if (appointmentMs <= nowMs) {
    throw new Error('Cannot schedule a follow-up for a past appointment.');
  }

  const reminder: FollowUpReminder = {
    id: uuidv4(),
    title,
    description,
    appointmentDateUtc,
    isCompleted: false,
    createdAt: new Date().toISOString(),
  };

  // T-24h notification
  const t24Ms = subHours(new Date(appointmentDateUtc), 24).getTime();
  if (t24Ms > nowMs) {
    reminder.t24NotificationId = await scheduleFollowUpNotification(
      reminder,
      t24Ms,
      `Tomorrow: ${title}`,
      description ?? 'Your appointment is in 24 hours.',
      cfg,
    );
  }

  // T-3h same-day notification
  const t3Ms = subHours(new Date(appointmentDateUtc), 3).getTime();
  if (t3Ms > nowMs) {
    reminder.sameDayNotificationId = await scheduleFollowUpNotification(
      reminder,
      t3Ms,
      `Today: ${title}`,
      description ?? 'Your appointment is in 3 hours.',
      cfg,
    );
  }

  await saveFollowUp(reminder);

  await logEngineEvent(AnalyticsEvent.FOLLOWUP_SCHEDULED, {
    reminderId: reminder.id,
    appointmentDateUtc,
    t24Scheduled: !!reminder.t24NotificationId,
    sameDayScheduled: !!reminder.sameDayNotificationId,
  });

  return reminder;
}

/**
 * Mark a follow-up as completed and cancel pending notifications.
 */
export async function completeFollowUp(reminderId: string): Promise<void> {
  const reminder = await getFollowUp(reminderId);
  if (!reminder) throw new Error(`FollowUpReminder not found: ${reminderId}`);

  if (reminder.t24NotificationId) {
    await cancelNotification(reminder.t24NotificationId).catch(() => {});
  }
  if (reminder.sameDayNotificationId) {
    await cancelNotification(reminder.sameDayNotificationId).catch(() => {});
  }

  const updated: FollowUpReminder = {
    ...reminder,
    isCompleted: true,
  };
  await saveFollowUp(updated);
}

/**
 * Delete a follow-up and cancel its notifications.
 */
export async function removeFollowUp(reminderId: string): Promise<void> {
  await completeFollowUp(reminderId); // cancel notifications
  await deleteFollowUp(reminderId);
}

/**
 * Get all upcoming (non-completed) follow-ups.
 */
export async function getUpcomingFollowUps(): Promise<FollowUpReminder[]> {
  const all = await getAllFollowUps();
  const now = new Date();
  return all.filter(
    (r) => !r.isCompleted && new Date(r.appointmentDateUtc) > now,
  );
}

// ─── Internal helper ─────────────────────────────────────────────────────────

async function scheduleFollowUpNotification(
  reminder: FollowUpReminder,
  triggerMs: number,
  title: string,
  body: string,
  config: EngineConfig,
): Promise<string> {
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: triggerMs,
    alarmManager: { allowWhileIdle: true },
  };

  return notifee.createTriggerNotification(
    {
      title,
      body,
      android: {
        channelId: config.followUpChannelId,
        smallIcon: 'ic_notification',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default', launchActivity: 'default' },
      } as never,
      data: { followUpId: reminder.id },
    },
    trigger,
  );
}
