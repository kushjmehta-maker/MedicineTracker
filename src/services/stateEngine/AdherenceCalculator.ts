import { parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { DoseStatus, AdherenceSummary } from '../../models';
import { getDosesForMedication } from '../storage/StorageService';

// ─────────────────────────────────────────────────────────────────────────────
// AdherenceCalculator
//
// Computes dose adherence metrics for a given medication over a date range.
//
// Adherence formula: taken / (taken + missed) × 100
// Skipped doses are excluded from the denominator (user's choice, not a miss).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate adherence for a single medication over the given date range.
 * @param medicationId - medication to calculate for
 * @param fromDate - ISO date string "YYYY-MM-DD" (inclusive start)
 * @param toDate   - ISO date string "YYYY-MM-DD" (inclusive end)
 */
export async function calculateAdherence(
  medicationId: string,
  fromDate: string,
  toDate: string,
): Promise<AdherenceSummary> {
  const allDoses = await getDosesForMedication(medicationId);

  const from = startOfDay(parseISO(fromDate));
  const to = endOfDay(parseISO(toDate));

  const dosesInRange = allDoses.filter((d) => {
    const t = parseISO(d.scheduledTimeUtc);
    return isWithinInterval(t, { start: from, end: to });
  });

  let taken = 0;
  let missed = 0;
  let skipped = 0;
  let snoozed = 0;

  for (const d of dosesInRange) {
    switch (d.status) {
      case DoseStatus.TAKEN:
        taken++;
        break;
      case DoseStatus.MISSED:
        missed++;
        break;
      case DoseStatus.SKIPPED:
        skipped++;
        break;
      default:
        break;
    }
    if (d.snoozeCount > 0) snoozed++;
  }

  const denominator = taken + missed;
  const adherencePercent = denominator === 0 ? 100 : Math.round((taken / denominator) * 100);

  return {
    medicationId,
    fromDate,
    toDate,
    totalScheduled: dosesInRange.length,
    taken,
    missed,
    skipped,
    snoozed,
    adherencePercent,
  };
}

/**
 * Get a quick adherence percentage for the last N days.
 */
export async function getRecentAdherence(
  medicationId: string,
  days = 7,
): Promise<number> {
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - days + 1);

  const summary = await calculateAdherence(
    medicationId,
    fromDate.toISOString().split('T')[0],
    toDate.toISOString().split('T')[0],
  );
  return summary.adherencePercent;
}
