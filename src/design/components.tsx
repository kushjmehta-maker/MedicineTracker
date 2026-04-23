import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Colors, Spacing, Radii, FontSize, FontWeight, Shadow } from './tokens';
import { Icon, IconName } from './icons';

// =============================================================================
// Shared UI primitives used across all screens.
// =============================================================================

// ── Card ──────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ── Button ────────────────────────────────────────────────────────────────────

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: ButtonProps) {
  const containerStyle = [
    styles.button,
    variant === 'primary'   && styles.buttonPrimary,
    variant === 'secondary' && styles.buttonSecondary,
    variant === 'danger'    && styles.buttonDanger,
    variant === 'ghost'     && styles.buttonGhost,
    (disabled || loading)   && styles.buttonDisabled,
    style,
  ];
  const labelStyle = [
    styles.buttonLabel,
    variant === 'secondary' && styles.buttonLabelSecondary,
    variant === 'ghost'     && styles.buttonLabelGhost,
  ];

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? Colors.textInverse : Colors.primary} />
      ) : (
        <Text style={labelStyle}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

// ── Pill (dose status badge) ──────────────────────────────────────────────────

interface PillProps {
  label: string;
  color: string;
}

export function Pill({ label, color }: PillProps) {
  return (
    <View style={[styles.pill, { backgroundColor: color + '22' }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

// ── SectionHeader ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, action, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={48} color={Colors.textTertiary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

// ── Label + helper text ───────────────────────────────────────────────────────

interface LabelProps {
  text: string;
  style?: TextStyle;
}
export function Label({ text, style }: LabelProps) {
  return <Text style={[styles.label, style]}>{text}</Text>;
}

// ── Divider ───────────────────────────────────────────────────────────────────

export function Divider() {
  return <View style={styles.divider} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.md,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonPrimary:   { backgroundColor: Colors.primary },
  buttonSecondary: { backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.primary },
  buttonDanger:    { backgroundColor: Colors.danger },
  buttonGhost:     { backgroundColor: 'transparent' },
  buttonDisabled:  { opacity: 0.5 },
  buttonLabel: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  buttonLabelSecondary: { color: Colors.primary },
  buttonLabelGhost:     { color: Colors.primary },
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radii.full,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  sectionAction: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: FontWeight.medium,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  emptyIcon:     { marginBottom: Spacing.md, alignItems: 'center' as const },
  emptyTitle:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary, textAlign: 'center' },
  emptySubtitle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm },
  emptyAction:   { marginTop: Spacing.lg, paddingHorizontal: Spacing.xl },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.divider,
    marginHorizontal: Spacing.md,
  },
});
