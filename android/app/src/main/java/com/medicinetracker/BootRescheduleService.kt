package com.medicinetracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * BootRescheduleService
 *
 * A HeadlessJsTaskService that launches the React Native JS engine in the
 * background (without any UI) to run the boot reschedule task.
 *
 * The JS task name "MedicineTrackerBootTask" must be registered in index.js:
 *
 *   AppRegistry.registerHeadlessTask(
 *     'MedicineTrackerBootTask',
 *     () => require('./src/headless/BootTask').default
 *   );
 *
 * On Android O+ this must run as a Foreground Service to avoid being killed.
 */
class BootRescheduleService : HeadlessJsTaskService() {

    companion object {
        private const val TAG = "MedTracker/BootService"
        private const val FOREGROUND_NOTIFICATION_ID = 9001
        private const val CHANNEL_ID = "medicine-boot-service"
        private const val TASK_TIMEOUT_MS = 30_000L  // 30 seconds max
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification())
        }
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        Log.i(TAG, "Starting HeadlessJS boot reschedule task.")
        return HeadlessJsTaskConfig(
            BootReceiver.TASK_NAME,
            Arguments.createMap().apply {
                putString("timezone", getCurrentTimezone())
            },
            TASK_TIMEOUT_MS,
            true, // allowedInForeground
        )
    }

    private fun getCurrentTimezone(): String {
        return java.util.TimeZone.getDefault().id
    }

    private fun buildForegroundNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Medicine Tracker Service",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Rescheduling medicine reminders after reboot."
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Medicine Tracker")
            .setContentText("Restoring your medicine reminders…")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }
}
