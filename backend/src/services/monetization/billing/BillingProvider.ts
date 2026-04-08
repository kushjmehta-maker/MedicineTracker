import { ReceiptVerificationResult, WebhookEvent, BillingProvider as BillingProviderType } from '../types';

// =============================================================================
// BillingProvider interface
//
// All billing integrations implement this contract.  The application layer
// depends only on this interface — never on a concrete class.
//
// Design:
//   • verifyReceipt     — called when the mobile app submits a purchase receipt
//   • syncSubscription  — called on app launch / daily to reconcile state
//   • verifyWebhookSignature — validates that a webhook payload is authentic
//   • parseWebhookEvent — deserialises the raw webhook body into a domain event
//
// Failure contract:
//   All methods throw BillingProviderError on hard failures.
//   The calling layer catches these and either retries or falls back to FREE.
// =============================================================================

export interface IBillingProvider {
  readonly providerName: BillingProviderType;

  /**
   * Verify a purchase receipt submitted by the mobile app.
   * Must validate the signature with the provider's server — NEVER trust
   * the client's claimed plan type.
   */
  verifyReceipt(
    receipt: string,
    userId: string,
  ): Promise<ReceiptVerificationResult>;

  /**
   * Sync the subscription state for a known provider subscription ID.
   * Used for reconciliation (daily cron, app foreground).
   */
  syncSubscription(
    providerSubscriptionId: string,
  ): Promise<ReceiptVerificationResult>;

  /**
   * Validate that a webhook POST body and its signature are authentic.
   * Returns true if the webhook is trustworthy.
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string,
  ): boolean;

  /**
   * Parse a raw webhook payload into a domain WebhookEvent.
   */
  parseWebhookEvent(rawBody: Buffer): WebhookEvent;
}

// ─── Shared error ─────────────────────────────────────────────────────────────

export class BillingProviderError extends Error {
  constructor(
    readonly provider: BillingProviderType,
    message: string,
    readonly retryable: boolean = true,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'BillingProviderError';
  }
}

// ─── Provider registry ────────────────────────────────────────────────────────
//
// A single registry maps provider names to instances.
// Avoids importing concrete classes throughout the codebase.

const _registry = new Map<BillingProviderType, IBillingProvider>();

export function registerBillingProvider(provider: IBillingProvider): void {
  _registry.set(provider.providerName, provider);
}

export function getBillingProvider(name: BillingProviderType): IBillingProvider {
  const provider = _registry.get(name);
  if (!provider) {
    throw new Error(`Billing provider '${name}' is not registered`);
  }
  return provider;
}
