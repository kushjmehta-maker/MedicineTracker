// =============================================================================
// Monetization types
//
// Shared enums and interfaces used across SubscriptionService,
// FeatureGateService, UsageLimitService, and the billing layer.
// =============================================================================

// ─── Plan & subscription ──────────────────────────────────────────────────────

export type PlanType = 'FREE' | 'PREMIUM' | 'FAMILY';
export type SubscriptionStatus = 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'TRIAL';
export type BillingProvider = 'PLAY_STORE' | 'APPLE' | 'INTERNAL';

export interface Subscription {
  id: string;
  userId: string;
  planType: PlanType;
  status: SubscriptionStatus;
  startDate: Date;
  endDate: Date | null;
  provider: BillingProvider | null;
  providerSubscriptionId: string | null;
  gracePeriodMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Feature flags ────────────────────────────────────────────────────────────

export type FeatureKey =
  | 'reminders'
  | 'missed_dose_detection'
  | 'basic_adherence'
  | 'advanced_adherence'
  | 'adaptive_notifications'
  | 'caregiver_access'
  | 'priority_notifications'
  | 'export_data'
  | 'unlimited_medicines'
  | 'doctor_followups';

export interface FeatureFlag {
  key: FeatureKey;
  description: string;
  isActive: boolean;
}

export interface PlanFeature {
  planType: PlanType;
  featureKey: FeatureKey;
  isEnabled: boolean;
}

// ─── Usage ────────────────────────────────────────────────────────────────────

export type MetricKey =
  | 'medicines_count'
  | 'caregivers_count'
  | 'followups_count';

export interface UsageLimit {
  planType: PlanType;
  metricKey: MetricKey;
  limitValue: number | null;  // null = unlimited
}

export interface UsageRecord {
  userId: string;
  metricKey: MetricKey;
  currentValue: number;
  updatedAt: Date;
}

// ─── Billing ──────────────────────────────────────────────────────────────────

export interface ReceiptVerificationResult {
  isValid: boolean;
  planType: PlanType;
  providerSubscriptionId: string;
  startDate: Date;
  endDate: Date | null;
  raw: Record<string, unknown>;
}

export interface WebhookEvent {
  provider: BillingProvider;
  providerSubscriptionId: string;
  eventType: 'PURCHASED' | 'RENEWED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
  planType: PlanType;
  endDate: Date | null;
  rawPayload: Record<string, unknown>;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class FeatureGateError extends Error {
  readonly statusCode = 403;
  constructor(
    readonly featureKey: FeatureKey,
    readonly planType: PlanType,
  ) {
    super(
      `Feature '${featureKey}' is not available on the ${planType} plan. Upgrade to unlock this feature.`,
    );
    this.name = 'FeatureGateError';
  }
}

export class UsageLimitError extends Error {
  readonly statusCode = 429;
  constructor(
    readonly metricKey: MetricKey,
    readonly currentValue: number,
    readonly limitValue: number,
    readonly planType: PlanType,
  ) {
    super(
      `Usage limit reached for '${metricKey}': ${currentValue}/${limitValue} on the ${planType} plan. Upgrade to continue.`,
    );
    this.name = 'UsageLimitError';
  }
}
