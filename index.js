/**
 * index.js — React Native entry point
 *
 * CRITICAL: Notifee background handler and HeadlessJS tasks MUST be registered
 * before AppRegistry.registerComponent so they are available when the app
 * is launched in the background (e.g. notification action, boot complete).
 */
import { AppRegistry } from 'react-native';
import { registerBackgroundHandler } from './src/services/notifications/NotificationService';

// ─── 1. Register Notifee background event handler ────────────────────────────
// This must be called before AppRegistry.registerComponent.
// It handles notification action button presses when the app is killed/background.
registerBackgroundHandler();

// ─── 2. Register HeadlessJS boot task ────────────────────────────────────────
// Called by BootRescheduleService after device reboot.
AppRegistry.registerHeadlessTask(
  'MedicineTrackerBootTask',
  () => require('./src/headless/BootTask').default,
);

// ─── 3. Register main app component ──────────────────────────────────────────
import App from './App';
AppRegistry.registerComponent('MedicineTracker', () => App);
