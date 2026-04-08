import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

// ── Auth stack ────────────────────────────────────────────────────────────────

export type AuthStackParamList = {
  PhoneEntry: undefined;
  OtpVerify: { phone: string };
};

// ── Main tab ──────────────────────────────────────────────────────────────────

export type MainTabParamList = {
  Home:      undefined;
  Medicines: undefined;
  Insights:  undefined;
  Care:      undefined;
  Profile:   undefined;
};

// ── Root navigator ────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Auth:       undefined;  // AuthStack (nested)
  Main:       undefined;  // MainTab   (nested)
  AddMedicine: undefined;
  Paywall:    undefined;
};

// ── Typed screen props helpers ────────────────────────────────────────────────

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type MainTabProps<T extends keyof MainTabParamList> =
  BottomTabScreenProps<MainTabParamList, T>;

export type RootScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
