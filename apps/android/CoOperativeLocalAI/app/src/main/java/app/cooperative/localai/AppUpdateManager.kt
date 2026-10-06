package app.cooperative.localai

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

data class AppUpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val downloadUrl: String,
    val notes: String,
)

data class AppDownloadProgress(
    val downloadedBytes: Long,
    val totalBytes: Long?,
)

class AppUpdateManager(
    private val context: Context,
) {
    private val preferences =
        context.getSharedPreferences("cooperative_updates", Context.MODE_PRIVATE)

    fun checkForUpdate(): AppUpdateInfo {
        val connection = (URL(UPDATE_METADATA_URL).openConnection() as HttpURLConnection)
        try {
            connection.instanceFollowRedirects = true
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty(
                "User-Agent",
                "CoOperativeLocalAI/${BuildConfig.VERSION_NAME}",
            )
            connection.connect()

            if (connection.responseCode !in 200..299) {
                error("Update check failed with HTTP ${connection.responseCode}.")
            }

            val json = connection.inputStream.bufferedReader().use { reader ->
                JSONObject(reader.readText())
            }

            return AppUpdateInfo(
                versionCode = json.getInt("versionCode"),
                versionName = json.getString("versionName"),
                downloadUrl = json.getString("downloadUrl"),
                notes = json.optString("notes"),
            )
        } finally {
            connection.disconnect()
        }
    }

    fun isUpdateAvailable(info: AppUpdateInfo): Boolean =
        info.versionCode > BuildConfig.VERSION_CODE

    fun downloadUpdate(
        info: AppUpdateInfo,
        onProgress: (AppDownloadProgress) -> Unit,
        onReady: (Uri) -> Unit,
        onError: (Throwable) -> Unit,
    ) {
        thread(name = "CoOperativeAppUpdate") {
            try {
                val manager =
                    context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val fileName = "CoOperativeLocalAI-${info.versionName}.apk"

                val request = DownloadManager.Request(Uri.parse(info.downloadUrl))
                    .setTitle("CoOperativeLocalAI ${info.versionName}")
                    .setDescription("Downloading CoOperativeLocalAI update")
                    .setMimeType(APK_MIME)
                    .setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                    )
                    .setDestinationInExternalFilesDir(
                        context,
                        Environment.DIRECTORY_DOWNLOADS,
                        fileName,
                    )

                val downloadId = manager.enqueue(request)

                while (true) {
                    manager.query(
                        DownloadManager.Query().setFilterById(downloadId),
                    ).use { cursor ->
                        if (!cursor.moveToFirst()) {
                            error("Android Download Manager lost the update download.")
                        }

                        val status = cursor.getInt(
                            cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS),
                        )
                        val downloaded = cursor.getLong(
                            cursor.getColumnIndexOrThrow(
                                DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR,
                            ),
                        )
                        val totalRaw = cursor.getLong(
                            cursor.getColumnIndexOrThrow(
                                DownloadManager.COLUMN_TOTAL_SIZE_BYTES,
                            ),
                        )
                        onProgress(
                            AppDownloadProgress(
                                downloadedBytes = downloaded.coerceAtLeast(0L),
                                totalBytes = totalRaw.takeIf { it > 0L },
                            ),
                        )

                        when (status) {
                            DownloadManager.STATUS_SUCCESSFUL -> {
                                val uri = manager.getUriForDownloadedFile(downloadId)
                                    ?: error("Android could not open the downloaded APK.")
                                savePendingApk(uri)
                                onReady(uri)
                                return@thread
                            }

                            DownloadManager.STATUS_FAILED -> {
                                val reason = cursor.getInt(
                                    cursor.getColumnIndexOrThrow(
                                        DownloadManager.COLUMN_REASON,
                                    ),
                                )
                                error("Android update download failed (reason $reason).")
                            }
                        }
                    }

                    Thread.sleep(700L)
                }
            } catch (error: Throwable) {
                onError(error)
            }
        }
    }

    fun canRequestPackageInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            context.packageManager.canRequestPackageInstalls()

    fun openInstallPermissionSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    fun installPendingIfAllowed(): Boolean {
        if (!canRequestPackageInstalls()) return false
        val rawUri = preferences.getString(KEY_PENDING_APK_URI, null) ?: return false
        preferences.edit().remove(KEY_PENDING_APK_URI).apply()
        launchInstaller(Uri.parse(rawUri))
        return true
    }

    fun requestInstall(uri: Uri): Boolean {
        savePendingApk(uri)
        if (!canRequestPackageInstalls()) {
            openInstallPermissionSettings()
            return false
        }

        preferences.edit().remove(KEY_PENDING_APK_URI).apply()
        launchInstaller(uri)
        return true
    }

    private fun savePendingApk(uri: Uri) {
        preferences.edit().putString(KEY_PENDING_APK_URI, uri.toString()).apply()
    }

    private fun launchInstaller(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(intent)
    }

    companion object {
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val KEY_PENDING_APK_URI = "pending_apk_uri"

        const val UPDATE_METADATA_URL =
            "https://github.com/zanibethel/CoOperative/releases/download/" +
                "android-alpha/android-update.json"
    }
}
