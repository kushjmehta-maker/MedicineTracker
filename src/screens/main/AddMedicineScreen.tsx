import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { medicinesApi } from '../../api/client';
import { useMedicineStore } from '../../store/medicineStore';
import { Button, Label, Card } from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';
import type { Medicine } from '../../store/medicineStore';

const FREQ_OPTIONS: Array<{ value: Medicine['frequencyType']; label: string }> = [
  { value: 'DAILY',          label: 'Daily' },
  { value: 'SPECIFIC_DAYS',  label: 'Specific days' },
  { value: 'INTERVAL_HOURS', label: 'Every N hours' },
  { value: 'AS_NEEDED',      label: 'As needed' },
];

const PRESET_ICONS = ['💊', '🩺', '💉', '🧴', '🌡️', '🫀', '🧬', '🌿'];
const PRESET_COLORS = [
  '#4A90D9', '#34C759', '#FF9500', '#FF3B30',
  '#AF52DE', '#FF2D55', '#5AC8FA', '#FFCC00',
];

export function AddMedicineScreen() {
  const navigation = useNavigation();
  const { appendMedicine } = useMedicineStore();

  const [name, setName]           = useState('');
  const [amount, setAmount]       = useState('1');
  const [unit, setUnit]           = useState('mg');
  const [freq, setFreq]           = useState<Medicine['frequencyType']>('DAILY');
  const [times, setTimes]         = useState<string[]>(['08:00']);
  const [icon, setIcon]           = useState('💊');
  const [color, setColor]         = useState(PRESET_COLORS[0]);
  const [notes, setNotes]         = useState('');
  const [loading, setLoading]     = useState(false);

  const addTime = () => setTimes((t) => [...t, '12:00']);
  const removeTime = (i: number) => setTimes((t) => t.filter((_, idx) => idx !== i));
  const updateTime = (i: number, val: string) =>
    setTimes((t) => t.map((old, idx) => (idx === i ? val : old)));

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter the medicine name.');
      return;
    }
    setLoading(true);
    try {
      const medicine = await medicinesApi.create({
        name: name.trim(),
        dosageAmount: parseFloat(amount) || 1,
        dosageUnit: unit,
        frequencyType: freq,
        reminderTimes: times,
        color,
        icon,
        notes: notes.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      appendMedicine(medicine);
      navigation.goBack();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add medicine';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {/* Name */}
      <Card style={styles.section}>
        <Label text="Medicine name *" />
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Metformin"
          placeholderTextColor={Colors.textDisabled}
        />
      </Card>

      {/* Dosage */}
      <Card style={styles.section}>
        <Label text="Dosage" />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.amountInput]}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={[styles.input, styles.unitInput]}
            value={unit}
            onChangeText={setUnit}
            placeholder="mg"
            placeholderTextColor={Colors.textDisabled}
          />
        </View>
      </Card>

      {/* Frequency */}
      <Card style={styles.section}>
        <Label text="Frequency" />
        <View style={styles.freqRow}>
          {FREQ_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.freqBtn, freq === opt.value && styles.freqBtnActive]}
              onPress={() => setFreq(opt.value)}
            >
              <Text style={[styles.freqText, freq === opt.value && styles.freqTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      {/* Reminder times */}
      {freq !== 'AS_NEEDED' && (
        <Card style={styles.section}>
          <Label text="Reminder times (HH:MM)" />
          {times.map((t, i) => (
            <View key={i} style={styles.timeRow}>
              <TextInput
                style={[styles.input, styles.timeInput]}
                value={t}
                onChangeText={(v) => updateTime(i, v)}
                placeholder="HH:MM"
                placeholderTextColor={Colors.textDisabled}
              />
              {times.length > 1 && (
                <TouchableOpacity onPress={() => removeTime(i)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity onPress={addTime}>
            <Text style={styles.addTime}>+ Add time</Text>
          </TouchableOpacity>
        </Card>
      )}

      {/* Icon picker */}
      <Card style={styles.section}>
        <Label text="Icon" />
        <View style={styles.iconRow}>
          {PRESET_ICONS.map((ic) => (
            <TouchableOpacity
              key={ic}
              style={[styles.iconBtn, icon === ic && styles.iconBtnActive]}
              onPress={() => setIcon(ic)}
            >
              <Text style={styles.iconBtnText}>{ic}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      {/* Color picker */}
      <Card style={styles.section}>
        <Label text="Color" />
        <View style={styles.colorRow}>
          {PRESET_COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
              onPress={() => setColor(c)}
            />
          ))}
        </View>
      </Card>

      {/* Notes */}
      <Card style={styles.section}>
        <Label text="Notes (optional)" />
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. Take with food"
          placeholderTextColor={Colors.textDisabled}
          multiline
          numberOfLines={3}
        />
      </Card>

      <Button label="Save Medicine" onPress={handleSave} loading={loading} style={styles.saveBtn} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.background },
  container: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  section: { gap: Spacing.xs },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radii.md,
    padding: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  row:         { flexDirection: 'row', gap: Spacing.sm },
  amountInput: { flex: 1 },
  unitInput:   { width: 80 },
  freqRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  freqBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  freqBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  freqText:      { fontSize: FontSize.sm, color: Colors.textSecondary },
  freqTextActive: { color: Colors.primary, fontWeight: FontWeight.semibold },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  timeInput: { flex: 1 },
  removeBtn: { padding: Spacing.xs },
  removeBtnText: { color: Colors.danger, fontSize: FontSize.md },
  addTime: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginTop: Spacing.xs },
  iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  iconBtnText:   { fontSize: 22 },
  colorRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  colorSwatch: { width: 32, height: 32, borderRadius: Radii.full, borderWidth: 2, borderColor: 'transparent' },
  colorSwatchActive: { borderColor: Colors.textPrimary },
  notesInput: { height: 80, textAlignVertical: 'top' },
  saveBtn: { marginTop: Spacing.sm },
});
