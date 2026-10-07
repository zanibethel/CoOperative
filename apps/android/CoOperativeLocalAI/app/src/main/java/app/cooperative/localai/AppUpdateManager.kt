package app.cooperative.localai

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipFile
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
                val updateDir =
                    context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                        ?: error("Android external download storage is unavailable.")
                val apkFile = File(updateDir, fileName)
                if (apkFile.exists() && !apkFile.delete()) {
                    error("Could not replace the previous downloaded update.")
                }

                val request = DownloadManager.Request(Uri.parse(info.downloadUrl))
                    .setTitle("CoOperativeLocalAI ${info.versionName}")
                    .setDescription("Downloading CoOperativeLocalAI update")
                    .setMimeType(APK_MIME)
                    .setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                    )
                    .setDestinationUri(Uri.fromFile(apkFile))

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
                                validateApk(apkFile, info)
                                savePendingApk(apkFile)
                                onReady(installerUri(apkFile))
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
        val rawPath = preferences.getString(KEY_PENDING_APK_PATH, null) ?: return false
        val apkFile = File(rawPath)
        if (!apkFile.isFile) {
            preferences.edit().remove(KEY_PENDING_APK_PATH).apply()
            return false
        }

        preferences.edit().remove(KEY_PENDING_APK_PATH).apply()
        launchInstaller(installerUri(apkFile))
        return true
    }

    fun requestInstall(uri: Uri): Boolean {
        if (!canRequestPackageInstalls()) {
            openInstallPermissionSettings()
            return false
        }

        launchInstaller(uri)
        return true
    }

    private fun validateApk(
        apkFile: File,
        info: AppUpdateInfo,
    ) {
        if (!apkFile.isFile || apkFile.length() < MIN_APK_BYTES) {
            error("Downloaded update is incomplete.")
        }

        FileInputStream(apkFile).use { input ->
            val signature = ByteArray(4)
            if (input.read(signature) != 4 ||
                signature[0] != 0x50.toByte() ||
                signature[1] != 0x4b.toByte()
            ) {
                error("Downloaded update is not a valid APK archive.")
            }
        }

        ZipFile(apkFile).use { zip ->
            if (zip.getEntry("AndroidManifest.xml") == null) {
                error("Downloaded update is missing AndroidManifest.xml.")
            }
            val hasDex = zip.entries().asSequence().any { entry ->
                entry.name == "classes.dex" ||
                    (entry.name.startsWith("classes") && entry.name.endsWith(".dex"))
            }
            if (!hasDex) {
                error("Downloaded update is missing executable app code.")
            }
        }

        val archiveInfo = context.packageManager.getPackageArchiveInfo(
            apkFile.absolutePath,
            0,
        ) ?: error("Android could not parse the downloaded APK before install.")

        if (archiveInfo.packageName != context.packageName) {
            error("Downloaded update has the wrong application package.")
        }

        val archiveVersionCode =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                archiveInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                archiveInfo.versionCode.toLong()
            }
        if (archiveVersionCode < info.versionCode.toLong()) {
            error("Downloaded update version does not match update metadata.")
        }
    }

    private fun savePendingApk(file: File) {
        preferences.edit()
            .putString(KEY_PENDING_APK_PATH, file.absolutePath)
            .apply()
    }

    private fun installerUri(file: File): Uri =
        FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            file,
        )

    private fun launchInstaller(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(intent)
    }

    companion object {
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val KEY_PENDING_APK_PATH = "pending_apk_path"
        private const val MIN_APK_BYTES = 1_000_000L

        const val UPDATE_METADATA_URL =
            "https://github.com/zanibethel/CoOperative/releases/download/" +
                "android-alpha/android-update.json"
    }
}
