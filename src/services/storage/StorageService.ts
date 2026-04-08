import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Medication,
  DoseInstance,
  ReminderLog,
  FollowUpReminder,
  EngineConfig,
  DEFAULT_ENGINE_CONFIG,
  DoseStatus,
} from '../../models';

// ─────────────────────────────────────────────────────────────────────────────
// StorageService
//
// Single point of truth for all local persistence.  Wraps AsyncStorage with:
//  • Type-safe CRUD helpers
//  • Index keys (separate from entity keys) to enable listing without full scan
//  • Atomic multi-key writes via AsyncStorage.multiSet
// ─────────────────────────────────────────────────────────────────────────────

const KEY = {
  medication: (id: string) => `med:${id}`,
  doseInstance: (id: string) => `dose:${id}`,
  reminderLog: (id: string) => `log:${id}`,
  followUp: (id: string) => `followup:${id}`,

  // Index keys — store arrays of IDs
  medicationsIndex: 'index:medications',
  dosesForMedication: (medId: string) => `index:doses:${medId}`,
  logsForDose: (doseId: string) => `index:logs:${doseId}`,
  followUpsIndex: 'index:followups',

  engineConfig: 'engine:config',
  lastKnownTimezone: 'engine:timezone',
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

async function setJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function getIndex(key: string): Promise<string[]> {
  return (await getJson<string[]>(key)) ?? [];
}

async function appendToIndex(key: string, id: string): Promise<void> {
  const ids = await getIndex(key);
  if (!ids.includes(id)) {
    ids.push(id);
    await setJson(key, ids);
  }
}

async function removeFromIndex(key: string, id: string): Promise<void> {
  const ids = await getIndex(key);
  const updated = ids.filter((i) => i !== id);
  await setJson(key, updated);
}

// ─── Medication ───────────────────────────────────────────────────────────────

export async function saveMedication(med: Medication): Promise<void> {
  await Promise.all([
    setJson(KEY.medication(med.id), med),
    appendToIndex(KEY.medicationsIndex, med.id),
  ]);
}

export async function getMedication(id: string): Promise<Medication | null> {
  return getJson<Medication>(KEY.medication(id));
}

export async function getAllMedications(): Promise<Medication[]> {
  const ids = await getIndex(KEY.medicationsIndex);
  const results = await Promise.all(ids.map((id) => getJson<Medication>(KEY.medication(id))));
  return results.filter((m): m is Medication => m !== null);
}

export async function getActiveMedications(): Promise<Medication[]> {
  const all = await getAllMedications();
  return all.filter((m) => m.isActive);
}

export async function deleteMedication(id: string): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEY.medication(id)),
    removeFromIndex(KEY.medicationsIndex, id),
  ]);
}

// ─── DoseInstance ─────────────────────────────────────────────────────────────

export async function saveDoseInstance(dose: DoseInstance): Promise<void> {
  await Promise.all([
    setJson(KEY.doseInstance(dose.id), dose),
    appendToIndex(KEY.dosesForMedication(dose.medicationId), dose.id),
  ]);
}

export async function getDoseInstance(id: string): Promise<DoseInstance | null> {
  return getJson<DoseInstance>(KEY.doseInstance(id));
}

export async function getDosesForMedication(medicationId: string): Promise<DoseInstance[]> {
  const ids = await getIndex(KEY.dosesForMedication(medicationId));
  const results = await Promise.all(
    ids.map((id) => getJson<DoseInstance>(KEY.doseInstance(id))),
  );
  return results.filter((d): d is DoseInstance => d !== null);
}

/**
 * Returns all dose instances across all medications.
 * Avoid calling this frequently — use per-medication queries where possible.
 */
export async function getAllDoseInstances(): Promise<DoseInstance[]> {
  const meds = await getAllMedications();
  const grouped = await Promise.all(
    meds.map((m) => getDosesForMedication(m.id)),
  );
  return grouped.flat();
}

/**
 * Returns dose instances that are scheduled/snoozed/triggered and whose
 * scheduled time is in the past beyond the missed window — used by
 * MissedDoseDetector.
 */
export async function getOverdueDoseInstances(nowUtc: Date): Promise<DoseInstance[]> {
  const meds = await getActiveMedications();
  const overdueStatus = new Set<DoseStatus>([
    DoseStatus.SCHEDULED,
    DoseStatus.TRIGGERED,
    DoseStatus.SNOOZED,
  ]);

  const allDoses = (
    await Promise.all(meds.map((m) => getDosesForMedication(m.id)))
  ).flat();

  return allDoses.filter((d) => {
    if (!overdueStatus.has(d.status)) return false;
    const checkTime = d.snoozedUntilUtc ?? d.scheduledTimeUtc;
    return new Date(checkTime) < nowUtc;
  });
}

export async function updateDoseInstance(dose: DoseInstance): Promise<void> {
  await setJson(KEY.doseInstance(dose.id), dose);
}

export async function deleteDoseInstancesForMedication(medicationId: string): Promise<void> {
  const doses = await getDosesForMedication(medicationId);
  await Promise.all(
    doses.map((d) => AsyncStorage.removeItem(KEY.doseInstance(d.id))),
  );
  await AsyncStorage.removeItem(KEY.dosesForMedication(medicationId));
}

// ─── ReminderLog ──────────────────────────────────────────────────────────────

export async function saveReminderLog(log: ReminderLog): Promise<void> {
  await Promise.all([
    setJson(KEY.reminderLog(log.id), log),
    appendToIndex(KEY.logsForDose(log.doseInstanceId), log.id),
  ]);
}

export async function getLogsForDose(doseInstanceId: string): Promise<ReminderLog[]> {
  const ids = await getIndex(KEY.logsForDose(doseInstanceId));
  const results = await Promise.all(
    ids.map((id) => getJson<ReminderLog>(KEY.reminderLog(id))),
  );
  return results.filter((l): l is ReminderLog => l !== null);
}

// ─── FollowUpReminder ─────────────────────────────────────────────────────────

export async function saveFollowUp(reminder: FollowUpReminder): Promise<void> {
  await Promise.all([
    setJson(KEY.followUp(reminder.id), reminder),
    appendToIndex(KEY.followUpsIndex, reminder.id),
  ]);
}

export async function getFollowUp(id: string): Promise<FollowUpReminder | null> {
  return getJson<FollowUpReminder>(KEY.followUp(id));
}

export async function getAllFollowUps(): Promise<FollowUpReminder[]> {
  const ids = await getIndex(KEY.followUpsIndex);
  const results = await Promise.all(
    ids.map((id) => getJson<FollowUpReminder>(KEY.followUp(id))),
  );
  return results.filter((f): f is FollowUpReminder => f !== null);
}

export async function deleteFollowUp(id: string): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(KEY.followUp(id)),
    removeFromIndex(KEY.followUpsIndex, id),
  ]);
}

// ─── Engine Config ────────────────────────────────────────────────────────────

export async function getEngineConfig(): Promise<EngineConfig> {
  return (await getJson<EngineConfig>(KEY.engineConfig)) ?? DEFAULT_ENGINE_CONFIG;
}

export async function saveEngineConfig(config: EngineConfig): Promise<void> {
  await setJson(KEY.engineConfig, config);
}

// ─── Timezone tracking ────────────────────────────────────────────────────────

export async function getLastKnownTimezone(): Promise<string | null> {
  return AsyncStorage.getItem(KEY.lastKnownTimezone);
}

export async function saveLastKnownTimezone(tz: string): Promise<void> {
  await AsyncStorage.setItem(KEY.lastKnownTimezone, tz);
}

// ─── Bulk reset (use only on app-data-clear / reinstall detection) ────────────

export async function clearAllEngineData(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const engineKeys = keys.filter(
    (k) =>
      k.startsWith('med:') ||
      k.startsWith('dose:') ||
      k.startsWith('log:') ||
      k.startsWith('followup:') ||
      k.startsWith('index:') ||
      k.startsWith('engine:'),
  );
  if (engineKeys.length > 0) {
    await AsyncStorage.multiRemove(engineKeys);
  }
}
