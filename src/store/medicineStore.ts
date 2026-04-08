import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// =============================================================================
// medicineStore — Client-side medicine + today's doses state
//
// Data flows:
//   loadMedicines()   → GET /v1/medications  (server-authoritative)
//   loadTodayDoses()  → GET /v1/doses/today
//   addMedicine()     → POST /v1/medications
//   logDose()         → POST /v1/doses/:id/taken | skip
// =============================================================================

export interface Medicine {
  id: string;
  name: string;
  dosageAmount: number;
  dosageUnit: string;
  frequencyType: 'DAILY' | 'SPECIFIC_DAYS' | 'INTERVAL_HOURS' | 'AS_NEEDED';
  reminderTimes: string[];   // HH:MM local
  color: string;
  icon: string;
  notes?: string;
  active: boolean;
}

export interface TodayDose {
  instanceId: string;
  medicationId: string;
  medicationName: string;
  dosageAmount: number;
  dosageUnit: string;
  scheduledTimeUtc: string;
  status: 'SCHEDULED' | 'TRIGGERED' | 'TAKEN' | 'MISSED' | 'SNOOZED' | 'SKIPPED';
  color: string;
  icon: string;
}

export interface AdherenceProfile {
  adherenceScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  adherenceRate: number;
  avgDelayMinutes: number;
  last7dTaken: number;
  last7dScheduled: number;
  last30dTaken: number;
  last30dScheduled: number;
}

interface MedicineState {
  medicines: Medicine[];
  todayDoses: TodayDose[];
  adherenceProfile: AdherenceProfile | null;
  loadingMedicines: boolean;
  loadingDoses: boolean;
  error: string | null;

  // Actions (implementations injected via apiClient in screen hooks)
  setMedicines: (medicines: Medicine[]) => void;
  setTodayDoses: (doses: TodayDose[]) => void;
  setAdherenceProfile: (profile: AdherenceProfile | null) => void;
  updateDoseStatus: (instanceId: string, status: TodayDose['status']) => void;
  appendMedicine: (medicine: Medicine) => void;
  setLoadingMedicines: (v: boolean) => void;
  setLoadingDoses: (v: boolean) => void;
  setError: (error: string | null) => void;
}

export const useMedicineStore = create<MedicineState>()(
  immer((set) => ({
    medicines: [],
    todayDoses: [],
    adherenceProfile: null,
    loadingMedicines: false,
    loadingDoses: false,
    error: null,

    setMedicines: (medicines) => set((state) => { state.medicines = medicines; }),
    setTodayDoses: (doses) => set((state) => { state.todayDoses = doses; }),
    setAdherenceProfile: (profile) => set((state) => { state.adherenceProfile = profile; }),

    updateDoseStatus: (instanceId, status) =>
      set((state) => {
        const dose = state.todayDoses.find((d) => d.instanceId === instanceId);
        if (dose) dose.status = status;
      }),

    appendMedicine: (medicine) =>
      set((state) => { state.medicines.push(medicine); }),

    setLoadingMedicines: (v) => set((state) => { state.loadingMedicines = v; }),
    setLoadingDoses:     (v) => set((state) => { state.loadingDoses = v; }),
    setError: (error) => set((state) => { state.error = error; }),
  })),
);
