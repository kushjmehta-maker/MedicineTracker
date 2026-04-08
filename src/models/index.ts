// ─────────────────────────────────────────────────────────────────────────────
// Core Data Models — Medicine Tracker Notification Engine
// All timestamps stored as ISO-8601 UTC strings.
// All schedule times stored as local HH:MM and converted to UTC at scheduling time.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum DoseStatus {
  SCHEDULED = 'SCHEDULED',   // Alarm is set, waiting for trigger time
  TRIGGERED = 'TRIGGERED',   // Notification has fired, awaiting user action
  TAKEN = 'TAKEN',           // User marked as taken
  SNOOZED = 'SNOOZED',       // User snoozed; a follow-up alarm is set
  MISSED = 'MISSED',         // Window elapsed without user action
  SKIPPED = 'SKIPPED',       // User explicitly skipped this dose
}

export enum FrequencyType {
  DAILY = 'DAILY',                     // Once per day
  TWICE_DAILY = 'TWICE_DAILY',         // Twice per day
  THREE_TIMES_DAILY = 'THREE_TIMES_DAILY',
  WEEKLY = 'WEEKLY',
  CUSTOM = 'CUSTOM',                   // Arbitrary scheduleTimes array
}

export enum AnalyticsEvent {
  REMINDER_SCHEDULED = 'REMINDER_SCHEDULED',
  REMINDER_DELIVERED = 'REMINDER_DELIVERED',
  REMINDER_OPENED = 'REMINDER_OPENED',
  DOSE_TAKEN = 'DOSE_TAKEN',
  DOSE_MISSED = 'DOSE_MISSED',
  DOSE_SNOOZED = 'DOSE_SNOOZED',
  DOSE_SKIPPED = 'DOSE_SKIPPED',
  BOOT_RESCHEDULE = 'BOOT_RESCHEDULE',
  TIMEZONE_CHANGE = 'TIMEZONE_CHANGE',
  FOLLOWUP_SCHEDULED = 'FOLLOWUP_SCHEDULED',
  FOLLOWUP_TRIGGERED = 'FOLLOWUP_TRIGGERED',
  ENGINE_INITIALIZED = 'ENGINE_INITIALIZED',
}

// ─── Domain models ───────────────────────────────────────────────────────────

/**
 * A time-of-day slot in local time (not UTC).
 * Stored per-medication; converted to UTC at scheduling time.
 */
export interface ScheduleTime {
  hour: number;   // 0–23
  minute: number; // 0–59
  label?: string; // e.g. "Morning", "Night"
}

/**
 * Core medicine entity.  scheduleTimes are in LOCAL time; the engine converts
 * them to UTC when generating DoseInstances.
 */
export interface Medication {
  id: string;
  name: string;
  dosage: string;                        // e.g. "500mg", "1 tablet"
  frequency: FrequencyType;
  scheduleTimes: ScheduleTime[];         // Local HH:MM slots
  startDate: string;                     // ISO date "YYYY-MM-DD"
  endDate?: string;                      // ISO date "YYYY-MM-DD"; undefined = ongoing
  missedDoseWindowMinutes: number;       // How long after scheduled time to wait before marking missed
  maxSnoozeCount: number;                // Hard cap on consecutive snoozes
  notes?: string;
  createdAt: string;                     // ISO UTC
  updatedAt: string;                     // ISO UTC
  isActive: boolean;
}

/**
 * A single schedulable dose event derived from a Medication.
 * Created by ReminderScheduler; one row per (medication × schedule_time × day).
 */
export interface DoseInstance {
  id: string;
  medicationId: string;
  scheduledTimeUtc: string;              // ISO UTC — source of truth for alarm time
  status: DoseStatus;
  snoozeCount: number;
  takenAt?: string;                      // ISO UTC
  missedAt?: string;                     // ISO UTC
  skippedAt?: string;                    // ISO UTC
  notificationId?: string;              // Notifee notification ID for this alarm
  snoozedUntilUtc?: string;             // ISO UTC — when the snooze alarm fires
  createdAt: string;
  updatedAt: string;
}

/**
 * Append-only audit log for every dose-state event.
 * Backend-ready; in MVP it is written to local storage only.
 */
export interface ReminderLog {
  id: string;
  doseInstanceId: string;
  medicationId: string;
  eventType: AnalyticsEvent;
  timestamp: string;                     // ISO UTC
  metadata?: Record<string, unknown>;
}

/**
 * A doctor appointment / lab-test follow-up.
 * Generates a T-24h and a same-day (T-3h) notification.
 */
export interface FollowUpReminder {
  id: string;
  title: string;
  description?: string;
  appointmentDateUtc: string;            // ISO UTC — appointment time
  t24NotificationId?: string;           // Notifee ID for T-24h reminder
  sameDayNotificationId?: string;       // Notifee ID for same-day reminder
  isCompleted: boolean;
  createdAt: string;                     // ISO UTC
}

// ─── Engine configuration ─────────────────────────────────────────────────────

export interface EngineConfig {
  defaultMissedDoseWindowMinutes: number;
  defaultMaxSnoozeCount: number;
  snoozePresetsMinutes: number[];        // Displayed as quick-pick options in UI
  precomputeDaysAhead: number;           // How many future days to precompute alarms
  notificationChannelId: string;
  nudgeChannelId: string;
  followUpChannelId: string;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  defaultMissedDoseWindowMinutes: 30,
  defaultMaxSnoozeCount: 3,
  snoozePresetsMinutes: [5, 10, 30],
  precomputeDaysAhead: 7,
  notificationChannelId: 'medicine-reminders',
  nudgeChannelId: 'missed-dose-nudge',
  followUpChannelId: 'follow-up-reminders',
};

// ─── Notification action IDs (shared between handler and service) ─────────────

export const NOTIFICATION_ACTION = {
  TAKEN: 'taken',
  SKIP: 'skip',
  SNOOZE_5: 'snooze_5',
  SNOOZE_10: 'snooze_10',
  SNOOZE_30: 'snooze_30',
} as const;

export type NotificationActionId = typeof NOTIFICATION_ACTION[keyof typeof NOTIFICATION_ACTION];

// ─── State machine — valid transitions ───────────────────────────────────────

export const VALID_TRANSITIONS: Readonly<Record<DoseStatus, DoseStatus[]>> = {
  [DoseStatus.SCHEDULED]: [DoseStatus.TRIGGERED, DoseStatus.MISSED],
  [DoseStatus.TRIGGERED]: [DoseStatus.TAKEN, DoseStatus.SNOOZED, DoseStatus.SKIPPED, DoseStatus.MISSED],
  [DoseStatus.SNOOZED]: [DoseStatus.TRIGGERED, DoseStatus.TAKEN, DoseStatus.SKIPPED, DoseStatus.MISSED],
  [DoseStatus.TAKEN]: [],      // Terminal
  [DoseStatus.MISSED]: [],     // Terminal
  [DoseStatus.SKIPPED]: [],    // Terminal
};

// ─── Adherence summary ────────────────────────────────────────────────────────

export interface AdherenceSummary {
  medicationId: string;
  fromDate: string;          // ISO date
  toDate: string;            // ISO date
  totalScheduled: number;
  taken: number;
  missed: number;
  skipped: number;
  snoozed: number;           // How many needed ≥1 snooze before being taken/missed
  adherencePercent: number;  // taken / (taken + missed) × 100, ignoring skipped
}
