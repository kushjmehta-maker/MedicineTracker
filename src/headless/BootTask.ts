import { notificationEngine } from '../NotificationEngine';

// ─────────────────────────────────────────────────────────────────────────────
// BootTask (HeadlessJS)
//
// Registered as the 'MedicineTrackerBootTask' HeadlessJS task in index.js.
// Runs in the background (no UI) immediately after device reboot.
//
// The Android BootRescheduleService passes `{ timezone: string }` as the task data.
// ─────────────────────────────────────────────────────────────────────────────

interface BootTaskData {
  timezone?: string;
}

export default async function BootTask(data: BootTaskData): Promise<void> {
  const timezone = data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    // Initialize the engine enough to hit storage (no UI needed)
    await notificationEngine.initialize(timezone);
    await notificationEngine.handleBootComplete(timezone);
  } catch (error) {
    console.error('[BootTask] Boot reschedule failed:', error);
    // Do NOT re-throw — a HeadlessJS task failure may prevent future tasks
  }
}
