package app.cooperative.localai

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object LocalModelCatalog {
    const val STARTER_MODEL_ID = "litert-community/Qwen3-0.6B-int4"
    const val STARTER_MODEL_FILE = "qwen3_0.6b_nothink_q4_block32_ekv1280.litertlm"
    const val STARTER_MODEL_URL =
        "https://huggingface.co/litert-community/Qwen3-0.6B-int4/resolve/main/" +
            "qwen3_0.6b_nothink_q4_block32_ekv1280.litertlm?download=true"
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

    val starterModelFile: File
        get() = File(modelsDir, LocalModelCatalog.STARTER_MODEL_FILE)

    val isStarterModelInstalled: Boolean
        get() = starterModelFile.isFile && starterModelFile.length() > 100L * 1024L * 1024L

    fun deleteStarterModel() {
        starterModelFile.delete()
        File(starterModelFile.absolutePath + ".part").delete()
    }

    fun downloadStarterModel(
        onProgress: (ModelDownloadProgress) -> Unit,
    ) {
        val target = starterModelFile
        if (isStarterModelInstalled) {
            onProgress(ModelDownloadProgress(target.length(), target.length()))
            return
        }

        val partial = File(target.absolutePath + ".part")
        partial.delete()

        val connection = (URL(LocalModelCatalog.STARTER_MODEL_URL)
            .openConnection() as HttpURLConnection)
        try {
            connection.instanceFollowRedirects = true
            connection.connectTimeout = 20_000
            connection.readTimeout = 120_000
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

            if (partial.length() < 100L * 1024L * 1024L) {
                error("Downloaded model is unexpectedly small.")
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
}
