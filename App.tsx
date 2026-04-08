import React, { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';

import { notificationEngine } from './src/NotificationEngine';
import { registerForegroundHandler } from './src/services/notifications/NotificationService';
import { useAuthStore } from './src/store/authStore';
import { useBillingStore } from './src/store/billingStore';
import { RootNavigator } from './src/navigation/RootNavigator';

// =============================================================================
// App.tsx — Root component
//
// Responsibilities:
//   • Bootstrap Firebase Auth listener (sets authStore.status)
//   • Initialize notification engine
//   • Load subscription state once authenticated
//   • Render navigation tree
// =============================================================================

export default function App(): React.JSX.Element {
  const { setFirebaseUser, status } = useAuthStore();
  const { loadSubscription } = useBillingStore();

  // ── Firebase Auth listener ────────────────────────────────────────────────
  useEffect(() => {
    const unsubAuth = auth().onAuthStateChanged(
      (user: FirebaseAuthTypes.User | null) => {
        setFirebaseUser(user);
      },
    );
    return unsubAuth;
  }, [setFirebaseUser]);

  // ── Load subscription once authenticated ──────────────────────────────────
  useEffect(() => {
    if (status === 'authenticated') {
      loadSubscription().catch(console.error);
    }
  }, [status, loadSubscription]);

  // ── Notification engine ───────────────────────────────────────────────────
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    notificationEngine.initialize(timezone).catch(console.error);

    const unsubFg = registerForegroundHandler();

    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        notificationEngine.onAppForeground(tz).catch(console.error);
      }
    });

    return () => {
      unsubFg();
      sub.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
