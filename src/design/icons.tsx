import React from 'react';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';

// =============================================================================
// Centralised icon helpers — replaces emoji with vector icons so they render
// reliably across all iOS simulator runtimes and devices.
// =============================================================================

export type IconName =
  | 'home' | 'pill' | 'chart' | 'stethoscope' | 'account'
  | 'check' | 'bell' | 'globe' | 'lock' | 'document'
  | 'heart' | 'star' | 'syringe' | 'bottle' | 'thermometer'
  | 'dna' | 'leaf' | 'heartPulse';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

const ICON_MAP: Record<IconName, { set: 'mci' | 'ion'; glyph: string }> = {
  home:         { set: 'mci', glyph: 'home' },
  pill:         { set: 'mci', glyph: 'pill' },
  chart:        { set: 'mci', glyph: 'chart-bar' },
  stethoscope:  { set: 'mci', glyph: 'stethoscope' },
  account:      { set: 'mci', glyph: 'account' },
  check:        { set: 'mci', glyph: 'check-circle' },
  bell:         { set: 'mci', glyph: 'bell' },
  globe:        { set: 'mci', glyph: 'earth' },
  lock:         { set: 'mci', glyph: 'lock' },
  document:     { set: 'mci', glyph: 'file-document-outline' },
  heart:        { set: 'mci', glyph: 'heart' },
  star:         { set: 'mci', glyph: 'star' },
  syringe:      { set: 'mci', glyph: 'needle' },
  bottle:       { set: 'mci', glyph: 'bottle-tonic' },
  thermometer:  { set: 'mci', glyph: 'thermometer' },
  dna:          { set: 'mci', glyph: 'dna' },
  leaf:         { set: 'mci', glyph: 'leaf' },
  heartPulse:   { set: 'mci', glyph: 'heart-pulse' },
};

export function Icon({ name, size = 24, color = '#333' }: IconProps) {
  const entry = ICON_MAP[name];
  if (entry.set === 'ion') {
    return <Ionicons name={entry.glyph} size={size} color={color} />;
  }
  return <MaterialCommunityIcons name={entry.glyph} size={size} color={color} />;
}

// Mapping from old emoji → IconName for medicine icon picker
export const EMOJI_TO_ICON: Record<string, IconName> = {
  '\u{1F48A}': 'pill',          // 💊
  '\u{1FA7A}': 'stethoscope',   // 🩺
  '\u{1F489}': 'syringe',       // 💉
  '\u{1F9F4}': 'bottle',        // 🧴
  '\u{1F321}': 'thermometer',   // 🌡️
  '\u{1FAC0}': 'heartPulse',    // 🫀
  '\u{1F9EC}': 'dna',           // 🧬
  '\u{1F33F}': 'leaf',          // 🌿
};

// All valid icon names as a Set for quick lookup
const ICON_NAMES = new Set<string>(Object.keys(ICON_MAP));

/** Resolve any icon string (emoji OR IconName) to a valid IconName, defaulting to 'pill'. */
export function resolveIcon(raw: string | undefined | null): IconName {
  if (!raw) return 'pill';
  // Already a valid IconName
  if (ICON_NAMES.has(raw)) return raw as IconName;
  // Try emoji mapping
  return EMOJI_TO_ICON[raw] ?? 'pill';
}

// Medicine preset icons for the picker
export const MEDICINE_ICONS: IconName[] = [
  'pill', 'stethoscope', 'syringe', 'bottle',
  'thermometer', 'heartPulse', 'dna', 'leaf',
];
