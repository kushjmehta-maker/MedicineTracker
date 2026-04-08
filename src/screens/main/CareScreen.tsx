import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, SectionHeader } from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';

const CARE_LINKS = [
  { icon: '🩺', title: 'Find a doctor',    subtitle: 'Search nearby physicians', url: 'https://www.zocdoc.com' },
  { icon: '💬', title: 'Ask a pharmacist', subtitle: 'Chat with a licensed pharmacist', url: 'https://www.pharmacychecker.com' },
  { icon: '📋', title: 'My health records', subtitle: 'View & share your records', url: null },
  { icon: '🚑', title: 'Emergency SOS',    subtitle: 'Dial 911 immediately', url: 'tel:911' },
];

export function CareScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <SectionHeader title="Care" />

        <Card style={styles.bannerCard}>
          <Text style={styles.bannerIcon}>❤️</Text>
          <View>
            <Text style={styles.bannerTitle}>Your health, our priority</Text>
            <Text style={styles.bannerSub}>
              Reach out to care providers or find resources below.
            </Text>
          </View>
        </Card>

        <Text style={styles.groupTitle}>Quick Actions</Text>
        {CARE_LINKS.map((item) => (
          <TouchableOpacity
            key={item.title}
            onPress={() => item.url && Linking.openURL(item.url)}
            activeOpacity={item.url ? 0.7 : 1}
          >
            <Card style={styles.actionCard}>
              <Text style={styles.actionIcon}>{item.icon}</Text>
              <View style={styles.actionInfo}>
                <Text style={styles.actionTitle}>{item.title}</Text>
                <Text style={styles.actionSub}>{item.subtitle}</Text>
              </View>
              {item.url && <Text style={styles.chevron}>›</Text>}
            </Card>
          </TouchableOpacity>
        ))}

        <Text style={styles.disclaimer}>
          MediTrack is not a medical device and does not provide medical advice.
          Always consult a qualified health professional for medical decisions.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  container: { padding: Spacing.md, gap: Spacing.md },

  bannerCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.primaryLight },
  bannerIcon: { fontSize: 36 },
  bannerTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.primary },
  bannerSub:   { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },

  groupTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textTertiary, marginTop: Spacing.sm },

  actionCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actionIcon: { fontSize: 28 },
  actionInfo: { flex: 1 },
  actionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.textPrimary },
  actionSub:   { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  chevron:     { fontSize: FontSize.xl, color: Colors.textTertiary },

  disclaimer: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing.md,
  },
});
