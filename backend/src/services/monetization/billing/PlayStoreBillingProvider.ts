import crypto from 'crypto';
import { IBillingProvider, BillingProviderError } from './BillingProvider';
import { ReceiptVerificationResult, WebhookEvent, PlanType } from '../types';
import { logger } from '../../../observability/logger';

// =============================================================================
// PlayStoreBillingProvider
//
// Stub implementation for Google Play Billing.
//
// Production checklist (replace stubs with real calls):
//   1. Use googleapis npm package (google-auth-library + androidpublisher v3)
//   2. verifyReceipt    → androidpublisher.purchases.subscriptions.get()
//   3. syncSubscription → same endpoint with stored orderId
//   4. Webhook validation → RTDN over Cloud Pub/Sub (no signature — validate JWT)
//   5. SKU → PlanType mapping lives in PLAY_STORE_SKU_MAP env var or DB table
// =============================================================================

const PLAY_STORE_PUBLIC_KEY = process.env.PLAY_STORE_PUBLIC_KEY ?? '';

// Maps Play Store product SKUs to internal plan types.
// In production, move to a DB table so SKUs can be added without a deploy.
const SKU_TO_PLAN: Record<string, PlanType> = {
  'medicine_tracker_premium_monthly': 'PREMIUM',
  'medicine_tracker_premium_annual':  'PREMIUM',
  'medicine_tracker_family_monthly':  'FAMILY',
  'medicine_tracker_family_annual':   'FAMILY',
};

export class PlayStoreBillingProvider implements IBillingProvider {
  readonly providerName = 'PLAY_STORE' as const;

  async verifyReceipt(
    receipt: string,
    userId: string,
  ): Promise<ReceiptVerificationResult> {
    logger.info({ userId, provider: 'PLAY_STORE' }, 'Verifying Play Store receipt');

    // ── STUB: In production, call androidpublisher.purchases.subscriptions.get()
    // The receipt is a JSON string from BillingClient.queryPurchasesAsync() on Android.
    let parsed: {
      productId?: string;
      purchaseToken?: string;
      orderId?: string;
      purchaseTime?: number;
      expiryTimeMillis?: number;
    };

    try {
      parsed = JSON.parse(receipt);
    } catch {
      throw new BillingProviderError('PLAY_STORE', 'Invalid receipt JSON', false);
    }

    const { productId, orderId, purchaseTime, expiryTimeMillis } = parsed;

    if (!productId || !orderId) {
      throw new BillingProviderError('PLAY_STORE', 'Missing productId or orderId', false);
    }

    const planType = SKU_TO_PLAN[productId];
    if (!planType) {
      throw new BillingProviderError(
        'PLAY_STORE',
        `Unknown SKU: ${productId}`,
        false,
      );
    }

    return {
      isValid: true,
      planType,
      providerSubscriptionId: orderId,
      startDate: purchaseTime ? new Date(purchaseTime) : new Date(),
      endDate: expiryTimeMillis ? new Date(expiryTimeMillis) : null,
      raw: parsed,
    };
  }

  async syncSubscription(
    providerSubscriptionId: string,
  ): Promise<ReceiptVerificationResult> {
    // STUB: call androidpublisher.purchases.subscriptions.get() with stored orderId
    logger.info({ providerSubscriptionId }, 'Syncing Play Store subscription (stub)');
    throw new BillingProviderError(
      'PLAY_STORE',
      'syncSubscription not yet implemented — use webhook for updates',
      false,
    );
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    // Play Store uses RTDN over Pub/Sub — the Pub/Sub push subscription sends
    // a JWT in Authorization header.  Production: verify the JWT against
    // Google's public keys (googleapis/auth-library).
    //
    // STUB: always returns true in development.
    if (!PLAY_STORE_PUBLIC_KEY) {
      logger.warn('PLAY_STORE_PUBLIC_KEY not set — webhook signature verification skipped (stub mode)');
      return true;
    }

    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(rawBody);
      return verifier.verify(PLAY_STORE_PUBLIC_KEY, signatureHeader, 'base64');
    } catch {
      return false;
    }
  }

  parseWebhookEvent(rawBody: Buffer): WebhookEvent {
    // Play Store RTDN payload is a Pub/Sub message with base64-encoded data.
    const message = JSON.parse(rawBody.toString()) as {
      message?: { data?: string };
    };

    const data = message?.message?.data;
    if (!data) {
      throw new BillingProviderError('PLAY_STORE', 'Missing Pub/Sub message data', false);
    }

    const notification = JSON.parse(
      Buffer.from(data, 'base64').toString('utf8'),
    ) as {
      subscriptionNotification?: {
        notificationType: number;
        purchaseToken: string;
        subscriptionId: string;
      };
    };

    const sub = notification.subscriptionNotification;
    if (!sub) {
      throw new BillingProviderError('PLAY_STORE', 'Not a subscription notification', false);
    }

    // notificationType mapping (Google Play spec):
    // 1 = RECOVERED, 2 = RENEWED, 3 = CANCELED, 4 = PURCHASED,
    // 5 = ON_HOLD, 6 = IN_GRACE_PERIOD, 7 = RESTARTED, 12 = EXPIRED
    const eventType = _mapPlayStoreNotificationType(sub.notificationType);
    const planType  = SKU_TO_PLAN[sub.subscriptionId] ?? 'PREMIUM';

    return {
      provider: 'PLAY_STORE',
      providerSubscriptionId: sub.purchaseToken,
      eventType,
      planType,
      endDate: null,  // Fetch exact expiry via syncSubscription if needed
      rawPayload: notification,
    };
  }
}

function _mapPlayStoreNotificationType(
  type: number,
): WebhookEvent['eventType'] {
  switch (type) {
    case 4: return 'PURCHASED';
    case 2:
    case 1: return 'RENEWED';
    case 3: return 'CANCELLED';
    case 12: return 'EXPIRED';
    default: return 'RENEWED';
  }
}
