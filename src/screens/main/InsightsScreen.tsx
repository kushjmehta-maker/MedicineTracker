import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { adherenceApi } from '../../api/client';
import { useMedicineStore } from '../../store/medicineStore';
import { Card, SectionHeader } from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';

export function InsightsScreen() {
  const { adherenceProfile, loadingDoses, setAdherenceProfile, setLoadingDoses } =
    useMedicineStore();
  const loading = loadingDoses;

  const load = useCallback(async () => {
    setLoadingDoses(true);
    try {
      const profile = await adherenceApi.profile();
      setAdherenceProfile(profile);
    } catch {
      // API not reachable or no data yet — show empty state
    } finally {
      setLoadingDoses(false);
    }
  }, [setAdherenceProfile, setLoadingDoses]);

  useEffect(() => { load(); }, [load]);

  const p = adherenceProfile;
  const riskColor = p
    ? { LOW: Colors.riskLow, MEDIUM: Colors.riskMedium, HIGH: Colors.riskHigh }[p.riskLevel]
    : Colors.textTertiary;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={Colors.primary} />
        }
      >
        <SectionHeader title="Adherence Insights" />

        {/* Adherence score ring substitute (text-based) */}
        <Card style={styles.scoreCard}>
          <View style={[styles.scoreBadge, { backgroundColor: riskColor + '22', borderColor: riskColor }]}>
            <Text style={[styles.scoreValue, { color: riskColor }]}>
              {p ? Math.round(p.adherenceScore * 100) : '--'}
            </Text>
            <Text style={styles.scoreLabel}>Score</Text>
          </View>
          <View style={styles.scoreDetails}>
            <Text style={styles.riskLabel}>
              {p ? p.riskLevel + ' RISK' : '—'}
            </Text>
            <Text style={styles.riskSub}>Based on last 7 days</Text>
          </View>
        </Card>

        {/* 7-day stats */}
        <Card style={styles.statsCard}>
          <Text style={styles.statsTitle}>Last 7 days</Text>
          <View style={styles.statsGrid}>
            <StatCell label="Doses taken"   value={p ? String(p.last7dTaken)    : '--'} />
            <StatCell label="Scheduled"     value={p ? String(p.last7dScheduled): '--'} />
            <StatCell label="Adherence"     value={p ? Math.round(p.adherenceRate  * 100) + '%' : '--'} />
            <StatCell label="Avg delay"     value={p ? Math.round(p.avgDelayMinutes) + 'm' : '--'} />
          </View>
        </Card>

        {/* 30-day stats */}
        <Card style={styles.statsCard}>
          <Text style={styles.statsTitle}>Last 30 days</Text>
          <View style={styles.statsGrid}>
            <StatCell label="Doses taken"   value={p ? String(p.last30dTaken)    : '--'} />
            <StatCell label="Scheduled"     value={p ? String(p.last30dScheduled): '--'} />
            <StatCell label="Adherence"
              value={p && p.last30dScheduled > 0
                ? Math.round((p.last30dTaken / p.last30dScheduled) * 100) + '%'
                : '--'}
            />
          </View>
        </Card>

        {/* Tips */}
        {p && p.riskLevel !== 'LOW' && (
          <Card style={styles.tipCard}>
            <Text style={styles.tipTitle}>Tip</Text>
            <Text style={styles.tipText}>
              {p.riskLevel === 'HIGH'
                ? 'Your adherence is low. Try setting reminders earlier or asking a caregiver to help.'
                : 'You\'re doing well! Try to reduce delays for an even better score.'}
            </Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={statStyles.cell}>
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  cell:  { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm },
  value: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  label: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2, textAlign: 'center' },
});

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  container:{ padding: Spacing.md, gap: Spacing.md },
  scoreCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  scoreBadge: {
    width: 96, height: 96,
    borderRadius: 48,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue:   { fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  scoreLabel:   { fontSize: FontSize.xs, color: Colors.textTertiary },
  scoreDetails: { flex: 1 },
  riskLabel:    { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  riskSub:      { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },

  statsCard:  {},
  statsTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary, marginBottom: Spacing.sm },
  statsGrid:  { flexDirection: 'row', flexWrap: 'wrap' },

  tipCard:  { backgroundColor: Colors.primaryLight },
  tipTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.primary, marginBottom: Spacing.xs },
  tipText:  { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
});
