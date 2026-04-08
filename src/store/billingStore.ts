import { create } from 'zustand';
import { Platform } from 'react-native';
import type { ProductPurchase } from 'react-native-iap';
import { subscriptionApi } from '../api/client';

// =============================================================================
// billingStore
//
// Holds current subscription state + exposes verifyAndSavePurchase() which:
//   1. Sends the platform receipt to our backend for server-side validation
//   2. Updates local planType on success
// =============================================================================

export type PlanType = 'FREE' | 'PREMIUM' | 'FAMILY';

interface BillingState {
  planType: PlanType;
  loading: boolean;
  error: string | null;

  loadSubscription: () => Promise<void>;
  verifyAndSavePurchase: (purchase: ProductPurchase) => Promise<void>;
}

export const useBillingStore = create<BillingState>((set) => ({
  planType: 'FREE',
  loading:  false,
  error:    null,

  loadSubscription: async () => {
    set({ loading: true, error: null });
    try {
      const sub = await subscriptionApi.current();
      set({ planType: (sub?.planType as PlanType) ?? 'FREE' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load subscription';
      set({ error: msg });
      // Silently fall back to FREE — never block the app
    } finally {
      set({ loading: false });
    }
  },

  verifyAndSavePurchase: async (purchase: ProductPurchase) => {
    set({ loading: true, error: null });
    try {
      await subscriptionApi.verifyReceipt({
        platform: Platform.OS as 'ios' | 'android',
        data: purchase.transactionReceipt ?? '',
        productId: purchase.productId,
      });
      // Reload authoritative plan from server
      const sub = await subscriptionApi.current();
      set({ planType: (sub?.planType as PlanType) ?? 'FREE' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to verify purchase';
      set({ error: msg });
      throw err; // re-throw so PaywallScreen can show an alert
    } finally {
      set({ loading: false });
    }
  },
}));
