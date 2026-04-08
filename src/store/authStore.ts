import { create } from 'zustand';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';

// =============================================================================
// authStore — Firebase Phone OTP auth state
//
// Flow:
//   1. sendOtp(phone)  → Firebase sends SMS, store saves confirmation
//   2. verifyOtp(code) → confirm() → Firebase session created
//   3. user reactive listener sets firebaseUser + idToken
//   4. logout()        → sign out Firebase, clear state
// =============================================================================

export type AuthStatus =
  | 'idle'
  | 'sending_otp'
  | 'awaiting_otp'
  | 'verifying'
  | 'authenticated'
  | 'error';

interface AuthState {
  status: AuthStatus;
  firebaseUser: FirebaseAuthTypes.User | null;
  idToken: string | null;
  phone: string;
  error: string | null;
  // Internal — Firebase OTP confirmation result
  _confirmation: FirebaseAuthTypes.ConfirmationResult | null;

  // Actions
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  setFirebaseUser: (user: FirebaseAuthTypes.User | null) => void;
  refreshToken: () => Promise<string | null>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  firebaseUser: null,
  idToken: null,
  phone: '',
  error: null,
  _confirmation: null,

  sendOtp: async (phone: string) => {
    set({ status: 'sending_otp', error: null, phone });
    try {
      const confirmation = await auth().signInWithPhoneNumber(phone);
      set({ status: 'awaiting_otp', _confirmation: confirmation });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP';
      set({ status: 'error', error: message });
      throw err;
    }
  },

  verifyOtp: async (code: string) => {
    const { _confirmation } = get();
    if (!_confirmation) {
      set({ status: 'error', error: 'No OTP session — request a new code' });
      return;
    }
    set({ status: 'verifying', error: null });
    try {
      await _confirmation.confirm(code);
      // onAuthStateChanged listener will fire next and set firebaseUser + idToken
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid OTP code';
      set({ status: 'error', error: message });
      throw err;
    }
  },

  logout: async () => {
    await auth().signOut();
    set({
      status: 'idle',
      firebaseUser: null,
      idToken: null,
      phone: '',
      error: null,
      _confirmation: null,
    });
  },

  setFirebaseUser: async (user: FirebaseAuthTypes.User | null) => {
    if (!user) {
      set({ firebaseUser: null, idToken: null, status: 'idle' });
      return;
    }
    const token = await user.getIdToken();
    set({ firebaseUser: user, idToken: token, status: 'authenticated' });
  },

  refreshToken: async () => {
    const { firebaseUser } = get();
    if (!firebaseUser) return null;
    const token = await firebaseUser.getIdToken(true);
    set({ idToken: token });
    return token;
  },
}));
