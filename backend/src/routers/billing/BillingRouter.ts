import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getBillingProvider } from '../../services/monetization/billing/BillingProvider';
import { handleSubscriptionUpdate, upsertSubscription } from '../../services/monetization/SubscriptionService';
import { BillingProviderError } from '../../services/monetization/billing/BillingProvider';
import { BillingProvider } from '../../services/monetization/types';
import { logger } from '../../observability/logger';

// =============================================================================
// BillingRouter
//
// POST /v1/billing/receipt/verify    — mobile submits purchase receipt
// POST /v1/billing/webhook/:provider — provider pushes subscription events
// GET  /v1/billing/plans             — returns available plans (public)
// GET  /v1/users/:user_id/subscription — returns user's current sub + features
// =============================================================================

const ReceiptSchema = z.object({
  user_id: z.string().uuid(),
  provider: z.enum(['PLAY_STORE', 'APPLE', 'INTERNAL']),
  receipt: z.string().min(1),
});

const PROVIDER_PARAM_SCHEMA = z.enum(['PLAY_STORE', 'APPLE', 'INTERNAL']);

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {

  // ─── POST /v1/billing/receipt/verify ───────────────────────────────────────
  // Called by the mobile app immediately after a successful in-app purchase.
  // We verify the receipt server-side, create/update the subscription row,
  // and return the activated plan.

  app.post(
    '/v1/billing/receipt/verify',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ReceiptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const { user_id, provider, receipt } = parsed.data;

      let billingProvider;
      try {
        billingProvider = getBillingProvider(provider as BillingProvider);
      } catch {
        return reply.status(400).send({ error: `Provider '${provider}' is not configured` });
      }

      let verification;
      try {
        verification = await billingProvider.verifyReceipt(receipt, user_id);
      } catch (err) {
        if (err instanceof BillingProviderError) {
          logger.warn({ err, userId: user_id, provider }, 'Receipt verification failed');
          return reply.status(402).send({
            error: 'Receipt verification failed',
            detail: err.message,
          });
        }
        throw err;
      }

      if (!verification.isValid) {
        return reply.status(402).send({ error: 'Receipt is not valid' });
      }

      const subscription = await upsertSubscription({
        userId: user_id,
        planType: verification.planType,
        status: 'ACTIVE',
        provider: provider as BillingProvider,
        providerSubscriptionId: verification.providerSubscriptionId,
        startDate: verification.startDate,
        endDate: verification.endDate,
      });

      logger.info(
        { userId: user_id, plan: verification.planType, provider },
        'Subscription activated via receipt verify',
      );

      return reply.status(200).send({
        plan_type: subscription.planType,
        status: subscription.status,
        start_date: subscription.startDate,
        end_date: subscription.endDate,
        provider_subscription_id: subscription.providerSubscriptionId,
      });
    },
  );

  // ─── POST /v1/billing/webhook/:provider ────────────────────────────────────
  // Called by billing providers (Play Store Pub/Sub, Apple Server Notifications).
  // We always return 200 immediately; processing is synchronous but errors are
  // swallowed so the provider doesn't retry indefinitely on our bugs.

  app.post(
    '/v1/billing/webhook/:provider',
    {
      config: { rawBody: true },  // requires @fastify/rawbody plugin
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const providerParam = PROVIDER_PARAM_SCHEMA.safeParse(
        (request.params as Record<string, string>).provider?.toUpperCase(),
      );
      if (!providerParam.success) {
        return reply.status(404).send({ error: 'Unknown provider' });
      }

      const providerName = providerParam.data as BillingProvider;

      let billingProvider;
      try {
        billingProvider = getBillingProvider(providerName);
      } catch {
        return reply.status(404).send({ error: `Provider '${providerName}' is not configured` });
      }

      // Raw body for signature verification
      const rawBody: Buffer = (request as FastifyRequest & { rawBody: Buffer }).rawBody;
      const signatureHeader = (request.headers['x-signature'] as string) ?? '';

      // 1. Validate signature — reject unsigned payloads immediately
      if (!billingProvider.verifyWebhookSignature(rawBody, signatureHeader)) {
        logger.warn({ provider: providerName }, 'Webhook signature verification failed');
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }

      // 2. Parse and process — always return 200 to prevent provider retry storms
      try {
        const event = billingProvider.parseWebhookEvent(rawBody);
        await handleSubscriptionUpdate(event);
        logger.info({ provider: providerName, eventType: event.eventType }, 'Webhook processed');
      } catch (err) {
        logger.error({ err, provider: providerName }, 'Webhook processing failed — returning 200 to prevent retry');
      }

      return reply.status(200).send({ received: true });
    },
  );

  // ─── GET /v1/billing/plans ─────────────────────────────────────────────────
  // Public endpoint — returns available plan metadata for the paywall UI.

  app.get('/v1/billing/plans', async (_request, reply) => {
    return reply.send({
      plans: [
        {
          type: 'FREE',
          name: 'Free',
          price_inr: 0,
          medicines_limit: 10,
          highlights: ['10 medicines', 'All reminders', 'Basic adherence', 'Doctor follow-ups'],
        },
        {
          type: 'PREMIUM',
          name: 'Premium',
          price_inr: 149,
          billing_period: 'monthly',
          medicines_limit: null,
          highlights: ['Unlimited medicines', 'Advanced adherence', 'Adaptive notifications', 'Caregiver access', 'Priority notifications', 'Data export'],
        },
        {
          type: 'FAMILY',
          name: 'Family',
          price_inr: 299,
          billing_period: 'monthly',
          medicines_limit: null,
          highlights: ['Everything in Premium', 'Up to 20 caregivers', 'Family dashboard'],
        },
      ],
    });
  });
}
