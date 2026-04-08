import { v4 as uuidv4 } from 'uuid';
import {
  Medication,
  FrequencyType,
  DoseStatus,
  DEFAULT_ENGINE_CONFIG,
} from '../models';
import { getAllMedications, getAllDoseInstances } from '../services/storage/StorageService';
import { notificationEngine } from '../NotificationEngine';
import { rescheduleAfterBoot } from '../services/boot/BootRescheduler';
import { handleTimezoneChange } from '../services/timezone/TimezoneHandler';
import { detectAndMarkMissedDoses } from '../services/scheduler/MissedDoseDetector';
import { getPendingNotificationIds } from '../services/notifications/NotificationService';

// ─────────────────────────────────────────────────────────────────────────────
// StressTestUtils
//
// Utilities for testing the notification engine under adverse conditions.
// NOT for production use — only enabled in __DEV__ builds.
// ─────────────────────────────────────────────────────────────────────────────

function requireDev(): void {
  if (!__DEV__) {
    throw new Error('StressTestUtils are only available in development builds.');
  }
}

// ─── Fixture factories ────────────────────────────────────────────────────────

/**
 * Generate N test medications with varied schedules.
 */
export function generateTestMedications(count: number, timezone = 'Asia/Kolkata'): Medication[] {
  requireDev();

  const scheduleVariants = [
    [{ hour: 8, minute: 0, label: 'Morning' }],
    [{ hour: 8, minute: 0, label: 'Morning' }, { hour: 20, minute: 0, label: 'Night' }],
    [
      { hour: 7, minute: 0, label: 'Morning' },
      { hour: 14, minute: 0, label: 'Afternoon' },
      { hour: 21, minute: 0, label: 'Night' },
    ],
    [{ hour: 22, minute: 30, label: 'Bedtime' }],
  ];

  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  return Array.from({ length: count }, (_, i) => ({
    id: uuidv4(),
    name: `TestMed ${i + 1}`,
    dosage: `${(i % 4 + 1) * 250}mg`,
    frequency: FrequencyType.CUSTOM,
    scheduleTimes: scheduleVariants[i % scheduleVariants.length],
    startDate: today,
    endDate: endDate.toISOString().split('T')[0],
    missedDoseWindowMinutes: DEFAULT_ENGINE_CONFIG.defaultMissedDoseWindowMinutes,
    maxSnoozeCount: DEFAULT_ENGINE_CONFIG.defaultMaxSnoozeCount,
    createdAt: now,
    updatedAt: now,
    isActive: true,
  }));
}

// ─── Scenario simulators ──────────────────────────────────────────────────────

/**
 * Add N test medications, schedule their reminders, and return a validation report.
 */
export async function runSchedulingStressTest(
  count: number,
  timezone = 'Asia/Kolkata',
): Promise<SchedulingStressReport> {
  requireDev();

  const meds = generateTestMedications(count, timezone);
  const scheduledCounts: number[] = [];

  for (const med of meds) {
    const doses = await notificationEngine.addMedication(med);
    scheduledCounts.push(doses.length);
  }

  const pendingIds = await getPendingNotificationIds();
  const dupCheck = await validateNoDuplicateNotifications();

  return {
    medicationsAdded: count,
    totalDosesScheduled: scheduledCounts.reduce((a, b) => a + b, 0),
    pendingNotifications: pendingIds.length,
    duplicatesFound: dupCheck.duplicateCount,
    notificationIds: pendingIds,
  };
}

/**
 * Simulate a device reboot: clear all alarms and reschedule.
 */
export async function simulateBoot(timezone = 'Asia/Kolkata'): Promise<void> {
  requireDev();
  console.log('[StressTest] Simulating device boot...');
  const result = await rescheduleAfterBoot(timezone);
  console.log('[StressTest] Boot reschedule complete:', result);
}

/**
 * Simulate a timezone change (e.g. traveling from India to UK).
 */
export async function simulateTimezoneChange(
  from: string,
  to: string,
): Promise<void> {
  requireDev();
  console.log(`[StressTest] Simulating timezone change: ${from} → ${to}`);
  const result = await handleTimezoneChange(from, to);
  console.log('[StressTest] Timezone change result:', result);
}

/**
 * Simulate passage of time by running missed dose detection,
 * as if the missedWindowMinutes have elapsed for all TRIGGERED doses.
 */
export async function simulateMissedDoses(): Promise<void> {
  requireDev();
  console.log('[StressTest] Running missed dose detection...');
  const result = await detectAndMarkMissedDoses();
  console.log(`[StressTest] Missed detection result: ${result.marked.length} marked as missed.`);
}

// ─── Validation helpers ───────────────────────────────────────────────────────

export interface SchedulingStressReport {
  medicationsAdded: number;
  totalDosesScheduled: number;
  pendingNotifications: number;
  duplicatesFound: number;
  notificationIds: string[];
}

export interface DuplicateCheckResult {
  duplicateCount: number;
  duplicates: Array<{ notificationId: string; count: number }>;
}

/**
 * Check for duplicate Notifee notification IDs — should always be 0.
 */
export async function validateNoDuplicateNotifications(): Promise<DuplicateCheckResult> {
  requireDev();

  const pendingIds = await getPendingNotificationIds();
  const counts: Record<string, number> = {};

  for (const id of pendingIds) {
    counts[id] = (counts[id] ?? 0) + 1;
  }

  const duplicates = Object.entries(counts)
    .filter(([, c]) => c > 1)
    .map(([notificationId, count]) => ({ notificationId, count }));

  return { duplicateCount: duplicates.length, duplicates };
}

/**
 * Verify that all active medications have at least one future SCHEDULED dose.
 */
export async function validateScheduleCoverage(): Promise<{
  covered: string[];
  uncovered: string[];
}> {
  requireDev();

  const medications = await getAllMedications();
  const allDoses = await getAllDoseInstances();
  const now = new Date();

  const futureScheduled = new Set(
    allDoses
      .filter(
        (d) =>
          d.status === DoseStatus.SCHEDULED && new Date(d.scheduledTimeUtc) > now,
      )
      .map((d) => d.medicationId),
  );

  const covered: string[] = [];
  const uncovered: string[] = [];

  for (const med of medications.filter((m) => m.isActive)) {
    if (futureScheduled.has(med.id)) {
      covered.push(med.name);
    } else {
      uncovered.push(med.name);
    }
  }

  return { covered, uncovered };
}

/**
 * Print a full engine state dump for debugging.
 */
export async function dumpEngineState(): Promise<void> {
  requireDev();

  const medications = await getAllMedications();
  const doses = await getAllDoseInstances();
  const pendingIds = await getPendingNotificationIds();

  console.group('[StressTest] Engine State Dump');
  console.log('Medications:', medications.length);
  console.log('Dose instances:', doses.length);
  console.log('Pending notifications:', pendingIds.length);

  const statusCounts: Record<string, number> = {};
  for (const d of doses) {
    statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1;
  }
  console.log('Dose status breakdown:', statusCounts);
  console.groupEnd();
}
