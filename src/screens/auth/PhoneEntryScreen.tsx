import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';
import type { AuthScreenProps } from '../../navigation/types';

export function PhoneEntryScreen({ navigation }: AuthScreenProps<'PhoneEntry'>) {
  const [phone, setPhone] = useState('+1');
  const { sendOtp, status, error } = useAuthStore();

  const isLoading = status === 'sending_otp';
  const isValid   = /^\+[1-9]\d{7,14}$/.test(phone);

  const handleContinue = async () => {
    if (!isValid) return;
    try {
      await sendOtp(phone);
      navigation.navigate('OtpVerify', { phone });
    } catch {
      // error is already set in store
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.logo}>💊</Text>
          <Text style={styles.title}>MediTrack</Text>
          <Text style={styles.subtitle}>
            Your personal medicine reminder assistant.{'\n'}Enter your phone number to get started.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Phone number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoFocus
            placeholder="+1 555 000 0000"
            placeholderTextColor={Colors.textDisabled}
          />
          <Text style={styles.hint}>Include country code (e.g. +1 for USA)</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label="Send Verification Code"
            onPress={handleContinue}
            loading={isLoading}
            disabled={!isValid || isLoading}
            style={styles.button}
          />
        </View>

        <Text style={styles.legal}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  container: {
    flexGrow: 1,
    padding: Spacing.lg,
    justifyContent: 'center',
  },
  header: { alignItems: 'center', marginBottom: Spacing.xxl },
  logo:     { fontSize: 64, marginBottom: Spacing.sm },
  title:    { fontSize: FontSize.xxxl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 22 },
  form: { backgroundColor: Colors.surface, borderRadius: Radii.lg, padding: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.textSecondary, marginBottom: Spacing.xs },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radii.md,
    padding: Spacing.md,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  hint:   { fontSize: FontSize.xs, color: Colors.textTertiary, marginBottom: Spacing.md },
  error:  { fontSize: FontSize.sm, color: Colors.danger, marginBottom: Spacing.md },
  button: { marginTop: Spacing.sm },
  legal:  { fontSize: FontSize.xs, color: Colors.textTertiary, textAlign: 'center', marginTop: Spacing.lg, lineHeight: 18 },
});
