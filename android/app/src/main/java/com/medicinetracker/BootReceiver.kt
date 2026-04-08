package com.medicinetracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * BootReceiver
 *
 * Receives the BOOT_COMPLETED and QUICKBOOT_POWERON broadcasts so the JS engine
 * can reschedule all AlarmManager alarms that were wiped on reboot.
 *
 * The receiver starts a lightweight HeadlessJS task that invokes
 * NotificationEngine.handleBootComplete() on the JS side.
 *
 * Registration in AndroidManifest.xml (see bottom of this file for snippet).
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "MedTracker/BootReceiver"
        const val TASK_NAME = "MedicineTrackerBootTask"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (!isBootIntent(intent)) return

        Log.i(TAG, "Boot broadcast received — starting reschedule task.")

        // Launch a React Native HeadlessJS service task
        val serviceIntent = Intent(context, BootRescheduleService::class.java).apply {
            putExtra("taskName", TASK_NAME)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }

    private fun isBootIntent(intent: Intent): Boolean {
        return intent.action == Intent.ACTION_BOOT_COMPLETED ||
                intent.action == "android.intent.action.QUICKBOOT_POWERON" ||
                intent.action == "com.htc.intent.action.QUICKBOOT_POWERON"
    }
}

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * Add to AndroidManifest.xml inside <application>:
 *
 *   <receiver
 *       android:name=".BootReceiver"
 *       android:enabled="true"
 *       android:exported="true">
 *     <intent-filter>
 *       <action android:name="android.intent.action.BOOT_COMPLETED"/>
 *       <action android:name="android.intent.action.QUICKBOOT_POWERON"/>
 *       <category android:name="android.intent.category.DEFAULT"/>
 *     </intent-filter>
 *   </receiver>
 *
 * Add to <manifest> permissions block:
 *
 *   <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
 *   <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>
 *   <uses-permission android:name="android.permission.USE_EXACT_ALARM"/>
 *   <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
 *   <uses-permission android:name="android.permission.VIBRATE"/>
 *   <uses-permission android:name="android.permission.WAKE_LOCK"/>
 *   <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>
 * ──────────────────────────────────────────────────────────────────────────────
 */
