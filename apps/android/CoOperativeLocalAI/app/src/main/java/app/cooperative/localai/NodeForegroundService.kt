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
    private var heartbeatThread: Thread? = null
    private var inferenceThread: Thread? = null
    private var textWorker: AndroidTextWorker? = null

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
            heartbeatThread = Thread({ heartbeatLoop() }, "CoOperativeAndroidHeartbeat").also {
                it.start()
            }
            inferenceThread = Thread({ inferenceLoop() }, "CoOperativeAndroidInference").also {
                it.start()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        heartbeatThread?.interrupt()
        inferenceThread?.interrupt()
        heartbeatThread = null
        inferenceThread = null
        textWorker?.close()
        textWorker = null
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
                when {
                    preferences.qualityModelVerified ->
                        "Online • quality reasoning + media planning ready"
                    preferences.localModelVerified ->
                        "Online • local text ready"
                    else ->
                        "Online • node only"
                }
            } catch (error: Exception) {
                val detail = error.message.orEmpty().take(100)
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

    private fun inferenceLoop() {
        val preferences = NodePreferences(this)
        val tokenStore = SecureTokenStore(this)
        val api = CooperativeApi(this, preferences, tokenStore)

        while (running.get()) {
            try {
                if (
                    !preferences.localModelVerified &&
                    !preferences.qualityModelVerified
                ) {
                    textWorker?.close()
                    textWorker = null
                    Thread.sleep(5_000L)
                    continue
                }

                if (textWorker == null) {
                    textWorker = AndroidTextWorker(this, api)
                }

                val didWork = textWorker?.pollOnce() == true
                Thread.sleep(if (didWork) 750L else 3_000L)
            } catch (_: InterruptedException) {
                break
            } catch (error: Exception) {
                val manager = getSystemService(NotificationManager::class.java)
                manager.notify(
                    NOTIFICATION_ID,
                    buildNotification(
                        "Local AI worker issue: ${error.message.orEmpty().take(80)}",
                    ),
                )
                try {
                    Thread.sleep(5_000L)
                } catch (_: InterruptedException) {
                    break
                }
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
