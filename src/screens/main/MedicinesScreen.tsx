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
import { medicinesApi } from '../../api/client';
import { Card, SectionHeader, EmptyState, Divider } from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';
import { Icon, resolveIcon } from '../../design/icons';
import type { Medicine } from '../../store/medicineStore';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type MedNav = NativeStackNavigationProp<RootStackParamList>;

const FREQ_LABEL: Record<Medicine['frequencyType'], string> = {
  DAILY:          'Daily',
  SPECIFIC_DAYS:  'Specific days',
  INTERVAL_HOURS: 'Every N hours',
  AS_NEEDED:      'As needed',
};

export function MedicinesScreen() {
  const navigation = useNavigation<MedNav>();
  const { medicines, loadingMedicines, setMedicines, setLoadingMedicines, setError } =
    useMedicineStore();

  const load = useCallback(async () => {
    setLoadingMedicines(true);
    try {
      const list = await medicinesApi.list();
      setMedicines(list);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load medicines';
      setError(msg);
    } finally {
      setLoadingMedicines(false);
    }
  }, [setMedicines, setLoadingMedicines, setError]);

  useEffect(() => { load(); }, [load]);

  const active   = medicines.filter((m) => m.active);
  const inactive = medicines.filter((m) => !m.active);

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={active}
        keyExtractor={(m) => m.id}
        refreshControl={
          <RefreshControl refreshing={loadingMedicines} onRefresh={load} tintColor={Colors.primary} />
        }
        ListHeaderComponent={
          <SectionHeader
            title="My Medicines"
            action="+ Add"
            onAction={() => navigation.navigate('AddMedicine')}
          />
        }
        ListEmptyComponent={
          loadingMedicines ? null : (
            <EmptyState
              icon="pill"
              title="No medicines yet"
              subtitle="Add your first medicine to start tracking."
              actionLabel="Add Medicine"
              onAction={() => navigation.navigate('AddMedicine')}
            />
          )
        }
        renderItem={({ item }) => <MedicineCard medicine={item} />}
        ListFooterComponent={
          inactive.length > 0 ? (
            <>
              <Divider />
              <SectionHeader title="Inactive" />
              {inactive.map((m) => (
                <MedicineCard key={m.id} medicine={m} />
              ))}
            </>
          ) : null
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

function MedicineCard({ medicine }: { medicine: Medicine }) {
  const timesStr = medicine.reminderTimes.slice(0, 3).join(', ') +
    (medicine.reminderTimes.length > 3 ? ` +${medicine.reminderTimes.length - 3}` : '');

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: medicine.color + '22' }]}>
          <Icon name={resolveIcon(medicine.icon)} size={24} color={medicine.color} />
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{medicine.name}</Text>
          <Text style={styles.meta}>
            {medicine.dosageAmount} {medicine.dosageUnit} · {FREQ_LABEL[medicine.frequencyType]}
          </Text>
          <Text style={styles.times}>{timesStr}</Text>
        </View>
        {!medicine.active && (
          <View style={styles.inactiveBadge}>
            <Text style={styles.inactiveBadgeText}>Inactive</Text>
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.md, gap: Spacing.sm },
  card: { marginBottom: 0 },
  row:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 48, height: 48, borderRadius: Radii.md, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 24 },
  info:     { flex: 1 },
  name:     { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  meta:     { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  times:    { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  inactiveBadge: {
    backgroundColor: Colors.border,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  inactiveBadgeText: { fontSize: FontSize.xs, color: Colors.textTertiary },
});
