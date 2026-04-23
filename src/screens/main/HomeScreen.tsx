import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMedicineStore } from '../../store/medicineStore';
import { dosesApi, medicinesApi, adherenceApi } from '../../api/client';
import {
  Card,
  Pill,
  SectionHeader,
  EmptyState,
} from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';
import { Icon, EMOJI_TO_ICON } from '../../design/icons';
import type { TodayDose } from '../../store/medicineStore';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type HomeNav = NativeStackNavigationProp<RootStackParamList>;

const STATUS_LABEL: Record<TodayDose['status'], string> = {
  SCHEDULED: 'Upcoming',
  TRIGGERED: 'Due Now',
  TAKEN:     'Taken',
  MISSED:    'Missed',
  SNOOZED:   'Snoozed',
  SKIPPED:   'Skipped',
};

const STATUS_COLOR: Record<TodayDose['status'], string> = {
  SCHEDULED: Colors.statusScheduled,
  TRIGGERED: Colors.warning,
  TAKEN:     Colors.statusTaken,
  MISSED:    Colors.statusMissed,
  SNOOZED:   Colors.statusSnoozed,
  SKIPPED:   Colors.statusSkipped,
};

export function HomeScreen() {
  const navigation = useNavigation<HomeNav>();
  const {
    todayDoses, adherenceProfile,
    loadingDoses,
    setTodayDoses, setAdherenceProfile, updateDoseStatus,
    setLoadingDoses, setError,
  } = useMedicineStore();

  const loadData = useCallback(async () => {
    setLoadingDoses(true);
    try {
      const [doses, profile] = await Promise.all([
        dosesApi.today(),
        adherenceApi.profile(),
      ]);
      setTodayDoses(doses);
      setAdherenceProfile(profile);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      setError(message);
    } finally {
      setLoadingDoses(false);
    }
  }, [setLoadingDoses, setTodayDoses, setAdherenceProfile, setError]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleTake = async (dose: TodayDose) => {
    updateDoseStatus(dose.instanceId, 'TAKEN');
    try {
      await dosesApi.markTaken(dose.instanceId);
    } catch {
      // revert on failure
      updateDoseStatus(dose.instanceId, dose.status);
    }
  };

  const handleSkip = async (dose: TodayDose) => {
    updateDoseStatus(dose.instanceId, 'SKIPPED');
    try {
      await dosesApi.markSkipped(dose.instanceId);
    } catch {
      updateDoseStatus(dose.instanceId, dose.status);
    }
  };

  const pendingDoses = todayDoses.filter(
    (d) => d.status === 'SCHEDULED' || d.status === 'TRIGGERED' || d.status === 'SNOOZED',
  );
  const doneDoses = todayDoses.filter(
    (d) => d.status === 'TAKEN' || d.status === 'MISSED' || d.status === 'SKIPPED',
  );

  const adherencePercent = adherenceProfile
    ? Math.round(adherenceProfile.adherenceRate * 100)
    : null;

  const riskColor = adherenceProfile
    ? { LOW: Colors.riskLow, MEDIUM: Colors.riskMedium, HIGH: Colors.riskHigh }[adherenceProfile.riskLevel]
    : Colors.textTertiary;

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={[...pendingDoses, ...doneDoses]}
        keyExtractor={(d) => d.instanceId}
        refreshControl={
          <RefreshControl refreshing={loadingDoses} onRefresh={loadData} tintColor={Colors.primary} />
        }
        ListHeaderComponent={
          <>
            {/* Adherence banner */}
            {adherenceProfile && (
              <Card style={styles.adherenceCard}>
                <Text style={styles.adherenceTitle}>Today's Adherence</Text>
                <View style={styles.adherenceRow}>
                  <View>
                    <Text style={[styles.adherenceScore, { color: riskColor }]}>
                      {adherencePercent}%
                    </Text>
                    <Text style={styles.adherenceLabel}>Last 7 days</Text>
                  </View>
                  <View style={styles.adherenceStats}>
                    <Text style={styles.adherenceStat}>
                      {adherenceProfile.last7dTaken}/{adherenceProfile.last7dScheduled} doses taken
                    </Text>
                    <Pill
                      label={adherenceProfile.riskLevel + ' RISK'}
                      color={riskColor}
                    />
                  </View>
                </View>
              </Card>
            )}

            <SectionHeader
              title={`Today (${pendingDoses.length} pending)`}
              action="+ Add"
              onAction={() => navigation.navigate('AddMedicine')}
            />
          </>
        }
        ListEmptyComponent={
          loadingDoses ? null : (
            <EmptyState
              icon="check"
              title="All done for today!"
              subtitle="You've taken all your medicines."
            />
          )
        }
        renderItem={({ item: dose }) => (
          <DoseCard
            dose={dose}
            onTake={() => handleTake(dose)}
            onSkip={() => handleSkip(dose)}
          />
        )}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

// ── DoseCard ──────────────────────────────────────────────────────────────────

interface DoseCardProps {
  dose: TodayDose;
  onTake: () => void;
  onSkip: () => void;
}

function DoseCard({ dose, onTake, onSkip }: DoseCardProps) {
  const isDone = dose.status === 'TAKEN' || dose.status === 'MISSED' || dose.status === 'SKIPPED';
  const statusColor = STATUS_COLOR[dose.status];

  const scheduledTime = new Date(dose.scheduledTimeUtc).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card style={[styles.doseCard, isDone && styles.doseCardDone]}>
      <View style={styles.doseRow}>
        <View style={[styles.doseIcon, { backgroundColor: dose.color + '22' }]}>
          <Icon name={EMOJI_TO_ICON[dose.icon] || 'pill'} size={22} color={dose.color} />
        </View>
        <View style={styles.doseInfo}>
          <Text style={styles.doseName}>{dose.medicationName}</Text>
          <Text style={styles.doseMeta}>
            {dose.dosageAmount} {dose.dosageUnit} · {scheduledTime}
          </Text>
        </View>
        <Pill label={STATUS_LABEL[dose.status]} color={statusColor} />
      </View>

      {!isDone && (
        <View style={styles.doseActions}>
          <TouchableOpacity style={[styles.actionBtn, styles.takeBtn]} onPress={onTake}>
            <Text style={styles.takeBtnText}>Take</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.skipBtn]} onPress={onSkip}>
            <Text style={styles.skipBtnText}>Skip</Text>
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.md, gap: Spacing.sm },

  adherenceCard: { marginBottom: Spacing.md },
  adherenceTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary, marginBottom: Spacing.sm },
  adherenceRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adherenceScore: { fontSize: FontSize.xxxl, fontWeight: FontWeight.bold },
  adherenceLabel: { fontSize: FontSize.xs, color: Colors.textTertiary },
  adherenceStats: { alignItems: 'flex-end', gap: Spacing.xs },
  adherenceStat:  { fontSize: FontSize.sm, color: Colors.textSecondary },

  doseCard: { marginBottom: 0 },
  doseCardDone: { opacity: 0.7 },
  doseRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  doseIcon: { width: 44, height: 44, borderRadius: Radii.md, alignItems: 'center', justifyContent: 'center' },
  doseIconText: { fontSize: 22 },
  doseInfo: { flex: 1 },
  doseName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  doseMeta: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },

  doseActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    alignItems: 'center',
  },
  takeBtn:     { backgroundColor: Colors.primary },
  skipBtn:     { backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border },
  takeBtnText: { color: Colors.textInverse, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  skipBtnText: { color: Colors.textSecondary, fontWeight: FontWeight.medium, fontSize: FontSize.sm },
});
