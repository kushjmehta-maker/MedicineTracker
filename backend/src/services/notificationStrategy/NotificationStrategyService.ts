import { getPool } from '../../db/client';

// ─────────────────────────────────────────────────────────────────────────────
// NotificationStrategyService
//
// Translates a precomputed risk_level into a concrete notification strategy
// object.  This is a deterministic lookup — no real-time computation happens
// here.  All heavy lifting was done by the nightly cron.
//
// Safety contract (from spec):
//   • Baseline reminders are NEVER suppressed
//   • HIGH risk = more nudges (not fewer reminders)
//   • Timing of medication is NEVER changed by this service
// ─────────────────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type Intensity = 'SOFT' | 'NORMAL' | 'LOUD';
export type VibrationPattern = 'soft' | 'normal' | 'strong';

export interface NotificationStrategy {
  initialIntensity: Intensity;
  nudgeScheduleMinutes: number[];
  maxNudges: number;
  persistentNotification: boolean;
  vibrationPattern: VibrationPattern;
}

export interface StrategyResponse {
  userId: string;
  riskLevel: RiskLevel;
  adherenceScore: number;
  strategy: NotificationStrategy;
  computedAt: string;
}

// ─── Strategy definitions ─────────────────────────────────────────────────────
// Hardcoded per spec — deterministic, no ML.

const STRATEGIES: Record<RiskLevel, NotificationStrategy> = {
  LOW: {
    initialIntensity: 'SOFT',
    nudgeScheduleMinutes: [20],
    maxNudges: 1,
    persistentNotification: false,
    vibrationPattern: 'soft',
  },
  MEDIUM: {
    initialIntensity: 'NORMAL',
    nudgeScheduleMinutes: [10, 25],
    maxNudges: 2,
    persistentNotification: false,
    vibrationPattern: 'normal',
  },
  HIGH: {
    initialIntensity: 'LOUD',
    nudgeScheduleMinutes: [5, 15],
    maxNudges: 3,
    persistentNotification: true,
    vibrationPattern: 'strong',
  },
};

/**
 * Get the notification strategy for a user.
 *
 * If no profile exists (new user or computation hasn't run yet), returns the
 * LOW/SOFT strategy as a safe default — never suppress reminders.
 */
export async function getStrategyForUser(userId: string): Promise<StrategyResponse> {
  const { rows } = await getPool().query<{
    user_id: string;
    risk_level: string;
    adherence_score: number;
    computed_at: Date;
  }>(
    `SELECT user_id, risk_level, adherence_score, computed_at
     FROM user_adherence_profiles
     WHERE user_id = $1`,
    [userId],
  );

  if (rows.length === 0) {
    // New user — default to LOW risk so notifications fire normally
    return buildResponse(userId, 'LOW', 1.0, new Date().toISOString());
  }

  const profile = rows[0];
  return buildResponse(
    profile.user_id,
    profile.risk_level as RiskLevel,
    profile.adherence_score,
    profile.computed_at.toISOString(),
  );
}

function buildResponse(
  userId: string,
  riskLevel: RiskLevel,
  adherenceScore: number,
  computedAt: string,
): StrategyResponse {
  return {
    userId,
    riskLevel,
    adherenceScore,
    strategy: STRATEGIES[riskLevel],
    computedAt,
  };
}
