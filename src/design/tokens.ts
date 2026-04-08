// =============================================================================
// Design tokens — single source of truth for colors, spacing, typography.
// All screen/component files import from here; never use magic numbers.
// =============================================================================

export const Colors = {
  // Brand
  primary:        '#4A90D9',
  primaryDark:    '#2C6FAD',
  primaryLight:   '#EAF3FB',

  // Semantic
  success:        '#34C759',
  warning:        '#FF9500',
  danger:         '#FF3B30',
  info:           '#5AC8FA',

  // Neutrals
  background:     '#F2F2F7',
  surface:        '#FFFFFF',
  surfaceAlt:     '#F8F8F8',
  border:         '#E5E5EA',
  divider:        '#C6C6C8',

  // Text
  textPrimary:    '#1C1C1E',
  textSecondary:  '#3C3C43',
  textTertiary:   '#8E8E93',
  textInverse:    '#FFFFFF',
  textDisabled:   '#C7C7CC',

  // Dose status pills
  statusTaken:    '#34C759',
  statusMissed:   '#FF3B30',
  statusSnoozed:  '#FF9500',
  statusScheduled:'#4A90D9',
  statusSkipped:  '#8E8E93',

  // Adherence risk
  riskLow:        '#34C759',
  riskMedium:     '#FF9500',
  riskHigh:       '#FF3B30',
} as const;

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

export const Radii = {
  sm:   6,
  md:   12,
  lg:   16,
  xl:   24,
  full: 9999,
} as const;

export const FontSize = {
  xs:   11,
  sm:   13,
  md:   15,
  lg:   17,
  xl:   20,
  xxl:  24,
  xxxl: 32,
} as const;

export const FontWeight = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 5,
  },
} as const;
