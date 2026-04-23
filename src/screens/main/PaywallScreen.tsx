import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  initConnection,
  getSubscriptions,
  requestSubscription,
  finishTransaction,
  purchaseErrorListener,
  purchaseUpdatedListener,
  type SubscriptionAndroid,
  type SubscriptionIOS,
  type ProductPurchase,
  type PurchaseError,
} from 'react-native-iap';
import { useBillingStore } from '../../store/billingStore';
import { Button } from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';
import { Icon } from '../../design/icons';
import { useNavigation } from '@react-navigation/native';

const PRODUCT_IDS = {
  monthly: 'com.meditrack.premium.monthly',
  annual:  'com.meditrack.premium.annual',
};

const FEATURES = [
  { icon: 'check' as const, text: 'Unlimited medicines' },
  { icon: 'check' as const, text: 'Advanced adherence analytics' },
  { icon: 'check' as const, text: 'Doctor follow-up tracking' },
  { icon: 'check' as const, text: 'Caregiver sharing' },
  { icon: 'check' as const, text: 'Adaptive smart reminders' },
  { icon: 'check' as const, text: 'Priority support' },
];

type Plan = 'monthly' | 'annual';

export function PaywallScreen() {
  const navigation = useNavigation();
  const { verifyAndSavePurchase } = useBillingStore();
  const [selectedPlan, setSelectedPlan] = useState<Plan>('annual');
  const [products, setProducts] = useState<(SubscriptionAndroid | SubscriptionIOS)[]>([]);
  const [purchasing, setPurchasing] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    let purchaseUpdateSub: ReturnType<typeof purchaseUpdatedListener>;
    let purchaseErrorSub:  ReturnType<typeof purchaseErrorListener>;

    const setup = async () => {
      try {
        await initConnection();
        const subs = await getSubscriptions({
          skus: [PRODUCT_IDS.monthly, PRODUCT_IDS.annual],
        });
        setProducts(subs);

        purchaseUpdateSub = purchaseUpdatedListener(async (purchase: ProductPurchase) => {
          try {
            await verifyAndSavePurchase(purchase);
            await finishTransaction({ purchase });
            navigation.goBack();
          } catch (err) {
            Alert.alert('Purchase Error', (err as Error).message);
          } finally {
            setPurchasing(false);
          }
        });

        purchaseErrorSub = purchaseErrorListener((error: PurchaseError) => {
          if (error.code !== 'E_USER_CANCELLED') {
            Alert.alert('Purchase failed', error.message);
          }
          setPurchasing(false);
        });
      } catch {
        // IAP not available in simulator — silently continue
      } finally {
        setLoadingProducts(false);
      }
    };

    setup();
    return () => {
      purchaseUpdateSub?.remove();
      purchaseErrorSub?.remove();
    };
  }, [navigation, verifyAndSavePurchase]);

  const handleSubscribe = async () => {
    const sku = PRODUCT_IDS[selectedPlan];
    setPurchasing(true);
    try {
      await requestSubscription({ sku });
    } catch (err) {
      const e = err as PurchaseError;
      if (e.code !== 'E_USER_CANCELLED') {
        Alert.alert('Purchase failed', e.message);
      }
      setPurchasing(false);
    }
  };

  const getPrice = (plan: Plan) => {
    const product = products.find((p) => p.productId === PRODUCT_IDS[plan]);
    if (!product) return plan === 'annual' ? '$49.99/yr' : '$5.99/mo';
    return (product as SubscriptionIOS).localizedPrice ??
      (product as SubscriptionAndroid).subscriptionOfferDetails?.[0]?.pricingPhases
        .pricingPhaseList[0]?.formattedPrice ??
      '';
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* Hero */}
      <View style={styles.hero}>
        <Icon name="star" size={56} color="#FFB800" />
        <Text style={styles.heroTitle}>Upgrade to Premium</Text>
        <Text style={styles.heroSub}>
          Take control of your health with advanced features designed to maximize adherence.
        </Text>
      </View>

      {/* Features */}
      <View style={styles.features}>
        {FEATURES.map((f) => (
          <View key={f.text} style={styles.featureRow}>
            <Icon name={f.icon} size={20} color={Colors.success} />
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* Plan selector */}
      {loadingProducts ? (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
      ) : (
        <View style={styles.plans}>
          {(['annual', 'monthly'] as Plan[]).map((plan) => (
            <TouchableOpacity
              key={plan}
              style={[styles.planCard, selectedPlan === plan && styles.planCardActive]}
              onPress={() => setSelectedPlan(plan)}
            >
              {plan === 'annual' && (
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>Save 30%</Text>
                </View>
              )}
              <Text style={[styles.planTitle, selectedPlan === plan && styles.planTitleActive]}>
                {plan === 'annual' ? 'Annual' : 'Monthly'}
              </Text>
              <Text style={[styles.planPrice, selectedPlan === plan && styles.planPriceActive]}>
                {getPrice(plan)}
              </Text>
              {plan === 'annual' && (
                <Text style={styles.planPriceSub}>≈ $4.17/mo</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Button
        label={purchasing ? 'Processing…' : 'Start Premium'}
        onPress={handleSubscribe}
        loading={purchasing}
        disabled={loadingProducts || purchasing}
        style={styles.ctaBtn}
      />

      <Text style={styles.legal}>
        Subscriptions auto-renew unless cancelled at least 24 hours before period end.
        Manage in your device's app store settings.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: Colors.background },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },

  hero:      { alignItems: 'center', marginBottom: Spacing.xl },
  heroIcon:  { fontSize: 56, marginBottom: Spacing.sm },
  heroTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.textPrimary, textAlign: 'center' },
  heroSub:   { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 22 },

  features:    { gap: Spacing.sm, marginBottom: Spacing.xl },
  featureRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  featureText: { fontSize: FontSize.md, color: Colors.textPrimary, lineHeight: 24 },

  plans: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  planCard: {
    flex: 1,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    alignItems: 'center',
    position: 'relative',
    backgroundColor: Colors.surface,
  },
  planCardActive:  { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  saveBadge: {
    position: 'absolute',
    top: -12,
    backgroundColor: Colors.success,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  saveBadgeText: { fontSize: FontSize.xs, color: Colors.textInverse, fontWeight: FontWeight.bold },
  planTitle:       { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary },
  planTitleActive: { color: Colors.primary },
  planPrice:       { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary, marginTop: Spacing.xs },
  planPriceActive: { color: Colors.primary },
  planPriceSub:    { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },

  ctaBtn: { marginBottom: Spacing.md },

  legal: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
