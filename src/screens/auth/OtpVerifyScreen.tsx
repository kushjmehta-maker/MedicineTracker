import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { Button } from '../../design/components';
import { Colors, Spacing, FontSize, FontWeight, Radii } from '../../design/tokens';
import type { AuthScreenProps } from '../../navigation/types';

const OTP_LENGTH = 6;

export function OtpVerifyScreen({ route }: AuthScreenProps<'OtpVerify'>) {
  const { phone } = route.params;
  const [otp, setOtp] = useState('');
  const inputRef = useRef<TextInput>(null);
  const { verifyOtp, sendOtp, status, error } = useAuthStore();

  const isVerifying = status === 'verifying';
  const isResending  = status === 'sending_otp';

  const handleVerify = async () => {
    if (otp.length !== OTP_LENGTH) return;
    try {
      await verifyOtp(otp);
    } catch {
      // error set in store
    }
  };

  const handleResend = async () => {
    setOtp('');
    try {
      await sendOtp(phone);
    } catch {
      // error set in store
    }
  };

  // Render digit boxes for visual OTP input
  const digits = otp.padEnd(OTP_LENGTH, ' ').split('');

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Enter verification code</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to{'\n'}
            <Text style={styles.phone}>{phone}</Text>
          </Text>
        </View>

        {/* Invisible real input; digit boxes are decorative */}
        <TouchableOpacity onPress={() => inputRef.current?.focus()} activeOpacity={1}>
          <View style={styles.digitsRow}>
            {digits.map((d, i) => (
              <View
                key={i}
                style={[
                  styles.digitBox,
                  i === otp.length && styles.digitBoxActive,
                  otp.length === OTP_LENGTH && styles.digitBoxFilled,
                ]}
              >
                <Text style={styles.digitText}>{d.trim()}</Text>
              </View>
            ))}
          </View>
          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, OTP_LENGTH))}
            keyboardType="number-pad"
            autoFocus
            style={styles.hiddenInput}
            caretHidden
          />
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label="Verify Code"
          onPress={handleVerify}
          loading={isVerifying}
          disabled={otp.length !== OTP_LENGTH || isVerifying}
          style={styles.button}
        />

        <View style={styles.resendRow}>
          <Text style={styles.resendText}>Didn't receive the code? </Text>
          <TouchableOpacity onPress={handleResend} disabled={isResending}>
            <Text style={[styles.resendLink, isResending && styles.disabled]}>
              {isResending ? 'Sending…' : 'Resend'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, padding: Spacing.lg, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: Spacing.xl },
  title:    { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 22 },
  phone:    { fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  digitsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: Spacing.lg },
  digitBox: {
    width: 46,
    height: 56,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  digitBoxActive: { borderColor: Colors.primary, borderWidth: 2 },
  digitBoxFilled: { borderColor: Colors.primary },
  digitText: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  hiddenInput: { position: 'absolute', opacity: 0, height: 0 },
  error:  { fontSize: FontSize.sm, color: Colors.danger, textAlign: 'center', marginBottom: Spacing.md },
  button: { marginTop: Spacing.sm },
  resendRow:  { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.lg },
  resendText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  resendLink: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.primary },
  disabled: { opacity: 0.4 },
});
