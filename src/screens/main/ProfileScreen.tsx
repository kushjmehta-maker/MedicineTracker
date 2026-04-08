import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { Card, Divider, Button } from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';

type ProfileNav = NativeStackNavigationProp<RootStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<ProfileNav>();
  const { phone, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>👤</Text>
          </View>
          <Text style={styles.phoneText}>{phone || '—'}</Text>
          <Text style={styles.phoneLabel}>Signed in via phone</Text>
        </View>

        {/* Plan */}
        <Card style={styles.planCard}>
          <View style={styles.planRow}>
            <View>
              <Text style={styles.planName}>Free Plan</Text>
              <Text style={styles.planSub}>Limited to 3 medicines · Basic reminders</Text>
            </View>
            <TouchableOpacity
              style={styles.upgradeBtn}
              onPress={() => navigation.navigate('Paywall')}
            >
              <Text style={styles.upgradeBtnText}>Upgrade</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Settings */}
        <Card>
          <SettingRow label="Notifications" icon="🔔" onPress={() => {}} />
          <Divider />
          <SettingRow label="Timezone" icon="🌍" value={Intl.DateTimeFormat().resolvedOptions().timeZone} />
          <Divider />
          <SettingRow label="Privacy Policy" icon="🔒" onPress={() => {}} />
          <Divider />
          <SettingRow label="Terms of Service" icon="📄" onPress={() => {}} />
        </Card>

        <Button label="Sign Out" onPress={handleLogout} variant="danger" />

        <Text style={styles.version}>MediTrack v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  label,
  icon,
  value,
  onPress,
}: {
  label: string;
  icon: string;
  value?: string;
  onPress?: () => void;
}) {
  const inner = (
    <View style={rowStyles.row}>
      <Text style={rowStyles.icon}>{icon}</Text>
      <Text style={rowStyles.label}>{label}</Text>
      {value ? (
        <Text style={rowStyles.value}>{value}</Text>
      ) : onPress ? (
        <Text style={rowStyles.chevron}>›</Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

const rowStyles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, gap: Spacing.sm },
  icon:    { fontSize: 20, width: 28, textAlign: 'center' },
  label:   { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary },
  value:   { fontSize: FontSize.sm, color: Colors.textTertiary },
  chevron: { fontSize: FontSize.xl, color: Colors.textTertiary },
});

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  container: { padding: Spacing.md, gap: Spacing.md },

  avatarSection: { alignItems: 'center', paddingVertical: Spacing.lg },
  avatar: {
    width: 80, height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  avatarText:  { fontSize: 40 },
  phoneText:   { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  phoneLabel:  { fontSize: FontSize.sm, color: Colors.textTertiary, marginTop: 2 },

  planCard:    {},
  planRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planName:    { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  planSub:     { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  upgradeBtn:  {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
  },
  upgradeBtnText: { color: Colors.textInverse, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },

  version: { textAlign: 'center', fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.sm },
});
