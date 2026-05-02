import crypto from 'crypto';
import { IBillingProvider, BillingProviderError } from './BillingProvider';
import { ReceiptVerificationResult, WebhookEvent, PlanType } from '../types';
import { logger } from '../../../observability/logger';

// =============================================================================
// AppStoreBillingProvider
//
// Stub implementation for Apple App Store (StoreKit 2 / App Store Server API).
//
// Production checklist:
//   1. Use App Store Server API (not legacy receipt validation)
//   2. verifyReceipt → POST /inApps/v1/lookup/{transactionId}
//   3. Signed JWS transaction objects — verify with Apple's root cert chain
//   4. Webhook validation → verify X-Apple-Signature-V2 ECDSA-P256 header
//   5. Product ID → PlanType mapping in APP_STORE_PRODUCT_MAP
// =============================================================================

const APPLE_WEBHOOK_SECRET = process.env.APPLE_WEBHOOK_SECRET ?? '';

// Maps App Store product IDs to internal plan types.
const PRODUCT_TO_PLAN: Record<string, PlanType> = {
  'com.offside.medicinetracker.premium.monthly': 'PREMIUM',
  'com.offside.medicinetracker.premium.annual':  'PREMIUM',
  'com.offside.medicinetracker.family.monthly':  'FAMILY',
  'com.offside.medicinetracker.family.annual':   'FAMILY',
};

export class AppStoreBillingProvider implements IBillingProvider {
  readonly providerName = 'APPLE' as const;

  async verifyReceipt(
    receipt: string,
    userId: string,
  ): Promise<ReceiptVerificationResult> {
    logger.info({ userId, provider: 'APPLE' }, 'Verifying App Store receipt (stub)');

    // STUB: In production, call App Store Server API to verify the JWS transaction.
    // The receipt here is a base64-encoded signed JWT (StoreKit 2 transaction).
    if (!receipt) {
      throw new BillingProviderError('APPLE', 'Empty receipt', false);
    }

    // Parse the JWT payload without verification (stub only — do NOT do this in prod)
    const parts = receipt.split('.');
    if (parts.length !== 3) {
      throw new BillingProviderError('APPLE', 'Invalid JWS format', false);
    }

    let payload: {
      productId?: string;
      originalTransactionId?: string;
      purchaseDate?: number;
      expiresDate?: number;
    };

    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new BillingProviderError('APPLE', 'Cannot decode JWS payload', false);
    }

    const planType = PRODUCT_TO_PLAN[payload.productId ?? ''];
    if (!planType) {
      throw new BillingProviderError('APPLE', `Unknown product ID: ${payload.productId}`, false);
    }

    return {
      isValid: true,
      planType,
      providerSubscriptionId: payload.originalTransactionId ?? receipt.slice(0, 32),
      startDate: payload.purchaseDate ? new Date(payload.purchaseDate) : new Date(),
      endDate: payload.expiresDate ? new Date(payload.expiresDate) : null,
      raw: payload,
    };
  }

  async syncSubscription(
    providerSubscriptionId: string,
  ): Promise<ReceiptVerificationResult> {
    // STUB: call App Store Server API GET /inApps/v1/subscriptions/{originalTransactionId}
    logger.info({ providerSubscriptionId }, 'Syncing App Store subscription (stub)');
    throw new BillingProviderError(
      'APPLE',
      'syncSubscription not yet implemented',
      false,
    );
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    // App Store Server Notifications v2 use ECDSA-P256 (X-Apple-Signature-V2).
    // STUB: check HMAC-SHA256 against APPLE_WEBHOOK_SECRET for dev testing.
    if (!APPLE_WEBHOOK_SECRET) {
      logger.warn('APPLE_WEBHOOK_SECRET not set — webhook signature verification skipped (stub)');
      return true;
    }
    const expected = crypto
      .createHmac('sha256', APPLE_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signatureHeader, 'hex'),
    );
  }

  parseWebhookEvent(rawBody: Buffer): WebhookEvent {
    // App Store Server Notifications v2 body is a signed JWS payload.
    // STUB: parse as plain JSON for development.
    const notification = JSON.parse(rawBody.toString()) as {
      notificationType?: string;
      data?: {
        signedTransactionInfo?: string;
        productId?: string;
        originalTransactionId?: string;
        expiresDateMs?: number;
      };
    };

    const { notificationType, data } = notification;

    if (!notificationType || !data) {
      throw new BillingProviderError('APPLE', 'Malformed App Store notification', false);
    }

    const eventType = _mapAppleNotificationType(notificationType);
    const planType  = PRODUCT_TO_PLAN[data.productId ?? ''] ?? 'PREMIUM';

    return {
      provider: 'APPLE',
      providerSubscriptionId: data.originalTransactionId ?? '',
      eventType,
      planType,
      endDate: data.expiresDateMs ? new Date(data.expiresDateMs) : null,
      rawPayload: notification,
    };
  }
}

function _mapAppleNotificationType(type: string): WebhookEvent['eventType'] {
  switch (type) {
    case 'SUBSCRIBED':    return 'PURCHASED';
    case 'DID_RENEW':     return 'RENEWED';
    case 'DID_CHANGE_RENEWAL_STATUS': return 'CANCELLED';
    case 'EXPIRED':       return 'EXPIRED';
    case 'REFUND':        return 'REFUNDED';
    default:              return 'RENEWED';
  }
}
