package app.cooperative.localai

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

enum class LocalModelProfile {
    FAST,
    QUALITY,
    HEAVY,
}

data class LocalModelSpec(
    val profile: LocalModelProfile,
    val id: String,
    val fileName: String,
    val downloadUrl: String,
    val approximateSizeMb: Int,
    val minimumBytes: Long,
)

object LocalModelCatalog {
    val FAST = LocalModelSpec(
        profile = LocalModelProfile.FAST,
        id = "litert-community/Qwen3-0.6B-int4",
        fileName = "qwen3_0.6b_nothink_q4_block32_ekv1280.litertlm",
        downloadUrl =
            "https://huggingface.co/litert-community/Qwen3-0.6B-int4/resolve/main/" +
                "qwen3_0.6b_nothink_q4_block32_ekv1280.litertlm?download=true",
        approximateSizeMb = 347,
        minimumBytes = 100L * 1024L * 1024L,
    )

    val QUALITY = LocalModelSpec(
        profile = LocalModelProfile.QUALITY,
        id = "litert-community/Qwen3-1.7B",
        fileName = "Qwen3-1.7B_dynamic_wi4b32_afp32.litertlm",
        downloadUrl =
            "https://huggingface.co/litert-community/Qwen3-1.7B/resolve/main/" +
                "Qwen3-1.7B_dynamic_wi4b32_afp32.litertlm?download=true",
        approximateSizeMb = 932,
        minimumBytes = 700L * 1024L * 1024L,
    )

    val HEAVY = LocalModelSpec(
        profile = LocalModelProfile.HEAVY,
        id = "litert-community/Qwen3-4B",
        fileName = "qwen3_4b_mixed_int4.litertlm",
        downloadUrl =
            "https://huggingface.co/litert-community/Qwen3-4B/resolve/main/" +
                "qwen3_4b_mixed_int4.litertlm?download=true",
        approximateSizeMb = 2536,
        minimumBytes = 2_000L * 1024L * 1024L,
    )

    fun spec(profile: LocalModelProfile): LocalModelSpec =
        when (profile) {
            LocalModelProfile.FAST -> FAST
            LocalModelProfile.QUALITY -> QUALITY
            LocalModelProfile.HEAVY -> HEAVY
        }
}

data class ModelDownloadProgress(
    val downloadedBytes: Long,
    val totalBytes: Long?,
)

class LocalModelManager(
    private val context: Context,
) {
    private val modelsDir: File
        get() = File(context.filesDir, "models").apply { mkdirs() }

    fun modelFile(profile: LocalModelProfile): File =
        File(modelsDir, LocalModelCatalog.spec(profile).fileName)

    fun isInstalled(profile: LocalModelProfile): Boolean {
        val spec = LocalModelCatalog.spec(profile)
        val file = modelFile(profile)
        return file.isFile && file.length() >= spec.minimumBytes
    }

    fun deleteModel(profile: LocalModelProfile) {
        val target = modelFile(profile)
        target.delete()
        File(target.absolutePath + ".part").delete()
    }

    fun downloadModel(
        profile: LocalModelProfile,
        onProgress: (ModelDownloadProgress) -> Unit,
    ) {
        val spec = LocalModelCatalog.spec(profile)
        val target = modelFile(profile)
        if (isInstalled(profile)) {
            onProgress(ModelDownloadProgress(target.length(), target.length()))
            return
        }

        val partial = File(target.absolutePath + ".part")
        partial.delete()

        val connection = (URL(spec.downloadUrl).openConnection() as HttpURLConnection)
        try {
            connection.instanceFollowRedirects = true
            connection.connectTimeout = 20_000
            connection.readTimeout = 180_000
            connection.setRequestProperty(
                "User-Agent",
                "CoOperativeLocalAI/${BuildConfig.VERSION_NAME}",
            )
            connection.connect()

            if (connection.responseCode !in 200..299) {
                error("Model download failed with HTTP ${connection.responseCode}.")
            }

            val total = connection.contentLengthLong.takeIf { it > 0L }
            connection.inputStream.use { input ->
                partial.outputStream().buffered().use { output ->
                    val buffer = ByteArray(1024 * 1024)
                    var downloaded = 0L
                    var lastReported = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        downloaded += count
                        if (downloaded - lastReported >= 4L * 1024L * 1024L) {
                            onProgress(ModelDownloadProgress(downloaded, total))
                            lastReported = downloaded
                        }
                    }
                    output.flush()
                    onProgress(ModelDownloadProgress(downloaded, total))
                }
            }

            if (partial.length() < spec.minimumBytes) {
                error("Downloaded ${spec.id} model is unexpectedly small.")
            }

            if (target.exists()) target.delete()
            if (!partial.renameTo(target)) {
                partial.copyTo(target, overwrite = true)
                partial.delete()
            }
        } catch (error: Exception) {
            partial.delete()
            throw error
        } finally {
            connection.disconnect()
        }
    }

    val starterModelFile: File
        get() = modelFile(LocalModelProfile.FAST)

    val isStarterModelInstalled: Boolean
        get() = isInstalled(LocalModelProfile.FAST)

    fun deleteStarterModel() = deleteModel(LocalModelProfile.FAST)

    fun downloadStarterModel(
        onProgress: (ModelDownloadProgress) -> Unit,
    ) = downloadModel(LocalModelProfile.FAST, onProgress)
}
