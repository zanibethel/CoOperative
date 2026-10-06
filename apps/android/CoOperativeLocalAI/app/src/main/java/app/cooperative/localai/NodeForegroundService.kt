package app.cooperative.localai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import java.util.concurrent.atomic.AtomicBoolean

class NodeForegroundService : Service() {
    private val running = AtomicBoolean(false)
    private var workerThread: Thread? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()

        val notification = buildNotification("Starting private Android node…")
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running.compareAndSet(false, true)) {
            workerThread = Thread({ heartbeatLoop() }, "CoOperativeAndroidNode").also {
                it.start()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        workerThread?.interrupt()
        workerThread = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun heartbeatLoop() {
        val preferences = NodePreferences(this)
        val tokenStore = SecureTokenStore(this)
        val api = CooperativeApi(this, preferences, tokenStore)

        while (running.get()) {
            val status = try {
                api.heartbeat()
                "Online • ${preferences.displayName}"
            } catch (error: Exception) {
                val detail = error.message.orEmpty().take(120)
                if (tokenStore.getNodeToken() == null) {
                    "Waiting for pairing"
                } else {
                    "Node connection issue${if (detail.isBlank()) "" else ": $detail"}"
                }
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager.notify(NOTIFICATION_ID, buildNotification(status))

            try {
                Thread.sleep(HEARTBEAT_MS)
            } catch (_: InterruptedException) {
                break
            }
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "CoOperative private node",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Keeps this phone available as a private CoOperative node."
            },
        )
    }

    private fun buildNotification(text: String): Notification =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("CoOperativeLocalAI")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("CoOperativeLocalAI")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build()
        }

    companion object {
        private const val CHANNEL_ID = "cooperative_private_node"
        private const val NOTIFICATION_ID = 7101
        private const val HEARTBEAT_MS = 20_000L
    }
}
