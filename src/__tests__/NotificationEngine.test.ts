/**
 * Integration tests for the notification engine core logic.
 * Storage and Notifee are mocked so these run without a device.
 */

import { DoseStatus, FrequencyType, DEFAULT_ENGINE_CONFIG, VALID_TRANSITIONS } from '../models';
import { InvalidTransitionError, transitionDose } from '../services/stateEngine/DoseStateEngine';
import { calculateAdherence } from '../services/stateEngine/AdherenceCalculator';
import { generateTestMedications } from '../testing/StressTestUtils';

// ─── Mock AsyncStorage ────────────────────────────────────────────────────────
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
  getAllKeys: jest.fn().mockResolvedValue([]),
}));

// ─── Mock Notifee ─────────────────────────────────────────────────────────────
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn().mockResolvedValue('channel-id'),
    createTriggerNotification: jest.fn().mockResolvedValue('notif-id'),
    cancelNotification: jest.fn().mockResolvedValue(undefined),
    cancelAllNotifications: jest.fn().mockResolvedValue(undefined),
    getTriggerNotifications: jest.fn().mockResolvedValue([]),
    requestPermission: jest.fn().mockResolvedValue({ authorizationStatus: 1 }),
    openPowerManagerSettings: jest.fn().mockResolvedValue(undefined),
    onBackgroundEvent: jest.fn(),
    onForegroundEvent: jest.fn().mockReturnValue(() => {}),
    displayNotification: jest.fn().mockResolvedValue('nudge-id'),
  },
  TriggerType: { TIMESTAMP: 0 },
  EventType: { ACTION_PRESS: 0, PRESS: 1, DISMISSED: 2 },
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
  AndroidVisibility: { PUBLIC: 1, PRIVATE: 0, SECRET: -1 },
  AndroidCategory: { ALARM: 'alarm', REMINDER: 'reminder' },
}));

// ─── State Machine Tests ──────────────────────────────────────────────────────

describe('DoseStatus state machine', () => {
  test('all terminal states have no valid transitions', () => {
    const terminals = [DoseStatus.TAKEN, DoseStatus.MISSED, DoseStatus.SKIPPED];
    for (const status of terminals) {
      expect(VALID_TRANSITIONS[status]).toHaveLength(0);
    }
  });

  test('SCHEDULED can transition to TRIGGERED', () => {
    expect(VALID_TRANSITIONS[DoseStatus.SCHEDULED]).toContain(DoseStatus.TRIGGERED);
  });

  test('TRIGGERED can transition to TAKEN, SNOOZED, SKIPPED, MISSED', () => {
    const allowed = VALID_TRANSITIONS[DoseStatus.TRIGGERED];
    expect(allowed).toContain(DoseStatus.TAKEN);
    expect(allowed).toContain(DoseStatus.SNOOZED);
    expect(allowed).toContain(DoseStatus.SKIPPED);
    expect(allowed).toContain(DoseStatus.MISSED);
  });

  test('SNOOZED can loop back to TRIGGERED', () => {
    expect(VALID_TRANSITIONS[DoseStatus.SNOOZED]).toContain(DoseStatus.TRIGGERED);
  });

  test('TAKEN cannot transition to SNOOZED', () => {
    expect(VALID_TRANSITIONS[DoseStatus.TAKEN]).not.toContain(DoseStatus.SNOOZED);
  });
});

// ─── Invalid transition test with mocked storage ──────────────────────────────

describe('DoseStateEngine.transitionDose', () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  afterEach(() => jest.clearAllMocks());

  test('throws InvalidTransitionError for TAKEN → SNOOZED', async () => {
    const mockDose = {
      id: 'dose-1',
      medicationId: 'med-1',
      scheduledTimeUtc: new Date().toISOString(),
      status: DoseStatus.TAKEN,
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(mockDose));

    await expect(transitionDose('dose-1', DoseStatus.SNOOZED)).rejects.toThrow(
      InvalidTransitionError,
    );
  });

  test('valid TRIGGERED → TAKEN transition persists updated dose', async () => {
    const mockDose = {
      id: 'dose-2',
      medicationId: 'med-1',
      scheduledTimeUtc: new Date().toISOString(),
      status: DoseStatus.TRIGGERED,
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(mockDose));

    const updated = await transitionDose('dose-2', DoseStatus.TAKEN, {
      takenAt: new Date().toISOString(),
    });

    expect(updated.status).toBe(DoseStatus.TAKEN);
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });
});

// ─── Adherence Calculator Tests ───────────────────────────────────────────────

describe('AdherenceCalculator.calculateAdherence', () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  afterEach(() => jest.clearAllMocks());

  function makeIndexKey(medId: string) {
    return `index:doses:${medId}`;
  }
  function makeDoseKey(id: string) {
    return `dose:${id}`;
  }

  test('100% adherence when all doses taken', async () => {
    const medId = 'med-adhtest';
    const today = new Date().toISOString().split('T')[0];

    const doses = [
      { id: 'd1', medicationId: medId, scheduledTimeUtc: `${today}T08:00:00.000Z`, status: DoseStatus.TAKEN, snoozeCount: 0 },
      { id: 'd2', medicationId: medId, scheduledTimeUtc: `${today}T20:00:00.000Z`, status: DoseStatus.TAKEN, snoozeCount: 0 },
    ];

    AsyncStorage.getItem.mockImplementation((key: string) => {
      if (key === makeIndexKey(medId)) return Promise.resolve(JSON.stringify(['d1', 'd2']));
      const dose = doses.find((d) => key === makeDoseKey(d.id));
      return Promise.resolve(dose ? JSON.stringify(dose) : null);
    });

    const summary = await calculateAdherence(medId, today, today);
    expect(summary.adherencePercent).toBe(100);
    expect(summary.taken).toBe(2);
    expect(summary.missed).toBe(0);
  });

  test('50% adherence with one taken, one missed', async () => {
    const medId = 'med-50pct';
    const today = new Date().toISOString().split('T')[0];

    const doses = [
      { id: 'e1', medicationId: medId, scheduledTimeUtc: `${today}T08:00:00.000Z`, status: DoseStatus.TAKEN, snoozeCount: 0 },
      { id: 'e2', medicationId: medId, scheduledTimeUtc: `${today}T20:00:00.000Z`, status: DoseStatus.MISSED, snoozeCount: 0 },
    ];

    AsyncStorage.getItem.mockImplementation((key: string) => {
      if (key === makeIndexKey(medId)) return Promise.resolve(JSON.stringify(['e1', 'e2']));
      const dose = doses.find((d) => key === makeDoseKey(d.id));
      return Promise.resolve(dose ? JSON.stringify(dose) : null);
    });

    const summary = await calculateAdherence(medId, today, today);
    expect(summary.adherencePercent).toBe(50);
  });

  test('skipped doses excluded from adherence denominator', async () => {
    const medId = 'med-skip';
    const today = new Date().toISOString().split('T')[0];

    const doses = [
      { id: 'f1', medicationId: medId, scheduledTimeUtc: `${today}T08:00:00.000Z`, status: DoseStatus.TAKEN, snoozeCount: 0 },
      { id: 'f2', medicationId: medId, scheduledTimeUtc: `${today}T20:00:00.000Z`, status: DoseStatus.SKIPPED, snoozeCount: 0 },
    ];

    AsyncStorage.getItem.mockImplementation((key: string) => {
      if (key === makeIndexKey(medId)) return Promise.resolve(JSON.stringify(['f1', 'f2']));
      const dose = doses.find((d) => key === makeDoseKey(d.id));
      return Promise.resolve(dose ? JSON.stringify(dose) : null);
    });

    const summary = await calculateAdherence(medId, today, today);
    // denominator = taken(1) + missed(0) = 1 → 100%
    expect(summary.adherencePercent).toBe(100);
    expect(summary.skipped).toBe(1);
  });
});

// ─── Config defaults ──────────────────────────────────────────────────────────

describe('DEFAULT_ENGINE_CONFIG', () => {
  test('has sensible defaults', () => {
    expect(DEFAULT_ENGINE_CONFIG.defaultMissedDoseWindowMinutes).toBe(30);
    expect(DEFAULT_ENGINE_CONFIG.defaultMaxSnoozeCount).toBe(3);
    expect(DEFAULT_ENGINE_CONFIG.snoozePresetsMinutes).toEqual([5, 10, 30]);
    expect(DEFAULT_ENGINE_CONFIG.precomputeDaysAhead).toBe(7);
  });
});

// ─── StressTestUtils fixture generator ───────────────────────────────────────

describe('generateTestMedications', () => {
  // Enable __DEV__ for this test
  const originalDev = (global as unknown as Record<string, unknown>).__DEV__;

  beforeAll(() => {
    (global as unknown as Record<string, unknown>).__DEV__ = true;
  });

  afterAll(() => {
    (global as unknown as Record<string, unknown>).__DEV__ = originalDev;
  });

  test('generates the requested count', () => {
    const meds = generateTestMedications(5);
    expect(meds).toHaveLength(5);
  });

  test('all generated medications have valid structure', () => {
    const meds = generateTestMedications(3);
    for (const med of meds) {
      expect(med.id).toBeTruthy();
      expect(med.name).toBeTruthy();
      expect(med.scheduleTimes.length).toBeGreaterThan(0);
      expect(med.isActive).toBe(true);
      expect(med.frequency).toBe(FrequencyType.CUSTOM);
    }
  });

  test('all schedule times are valid HH:MM', () => {
    const meds = generateTestMedications(10);
    for (const med of meds) {
      for (const slot of med.scheduleTimes) {
        expect(slot.hour).toBeGreaterThanOrEqual(0);
        expect(slot.hour).toBeLessThanOrEqual(23);
        expect(slot.minute).toBeGreaterThanOrEqual(0);
        expect(slot.minute).toBeLessThanOrEqual(59);
      }
    }
  });
});
