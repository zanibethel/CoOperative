package app.cooperative.localai

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class PairResult(
    val nodeToken: String,
    val ownerRef: String,
    val nodeClass: String,
)

class CooperativeApi(
    private val context: Context,
    private val preferences: NodePreferences,
    private val tokenStore: SecureTokenStore,
) {
    private val baseUrl = BuildConfig.COOPERATIVE_BASE_URL.trimEnd('/')

    fun pair(pairingCode: String): PairResult {
        val payload = JSONObject()
            .put("pairingCode", pairingCode.trim())
            .put("nodeId", preferences.nodeId)
            .put("displayName", preferences.displayName)

        val response = post(
            path = "/api/unison/nodes/pair",
            body = payload,
            bearerToken = null,
        ) ?: error("CoOperative returned an empty pairing response.")

        val result = PairResult(
            nodeToken = response.getString("nodeToken"),
            ownerRef = response.optString("ownerRef", "platform-private"),
            nodeClass = response.optString("nodeClass", "private"),
        )
        tokenStore.saveNodeToken(result.nodeToken)
        preferences.ownerRef = result.ownerRef
        preferences.nodeClass = result.nodeClass
        return result
    }

    fun heartbeat(): JSONObject {
        val token = requireNodeToken()

        val memoryInfo = ActivityManager.MemoryInfo()
        val activityManager =
            context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        activityManager.getMemoryInfo(memoryInfo)

        val memoryTotalMb = (memoryInfo.totalMem / (1024L * 1024L))
            .coerceAtLeast(1L)
            .coerceAtMost(Int.MAX_VALUE.toLong())
            .toInt()
        val verified = preferences.localModelVerified

        val capabilities = JSONArray()
            .put("android_node")
            .put("local_chat_client")
            .put("device_runtime_alpha")
        if (verified) {
            capabilities
                .put("local_text_generation")
                .put("text_generation")
        }

        val platform = JSONObject()
            .put("system", "Android")
            .put("release", Build.VERSION.RELEASE.orEmpty())
            .put("machine", Build.SUPPORTED_ABIS.firstOrNull().orEmpty())

        val resources = JSONObject()
            .put("cpuLogical", Runtime.getRuntime().availableProcessors().coerceAtLeast(1))
            .put("memoryTotalMb", memoryTotalMb)
            .put("gpus", JSONArray())
            .put("maxCpuPercent", 60)
            .put("maxGpuPercent", 50)
            .put("maxMemoryMb", (memoryTotalMb * 0.55).toInt().coerceAtLeast(256))

        if (verified) {
            resources.put(
                "textModelPlan",
                JSONObject()
                    .put("revision", "android-alpha02")
                    .put("backend", "litertlm-cpu")
                    .put(
                        "models",
                        JSONObject()
                            .put("fast", preferences.localModelId)
                            .put("quality", "")
                            .put("heavy", "")
                            .put("vision", ""),
                    )
                    .put(
                        "selectionReason",
                        "Verified on this Android device before enabling personal text queue execution.",
                    ),
            )
            resources.put(
                "textBenchmark",
                JSONObject()
                    .put("profile", "fast")
                    .put("model", preferences.localModelId)
                    .put("provider", "cooperative-android-litertlm")
                    .put("outputTokens", 0)
                    .put("latencyMs", preferences.localModelLatencyMs)
                    .put("recordedAt", preferences.localModelVerifiedAt),
            )
        }

        val policy = JSONObject()
            .put("idleOnly", false)
            .put("idleThresholdSeconds", 0)
            .put("allowImage", false)
            .put("allowText", verified)
            .put("idleScope", "session")

        val payload = JSONObject()
            .put("nodeId", preferences.nodeId)
            .put("displayName", preferences.displayName)
            .put("ownerRef", preferences.ownerRef)
            .put("nodeClass", preferences.nodeClass)
            .put("state", "online")
            .put("platform", platform)
            .put("capabilities", capabilities)
            .put("resources", resources)
            .put("policy", policy)
            .put("workerVersion", "android-local-ai-0.2.0")

        return post(
            path = "/api/unison/nodes/heartbeat",
            body = payload,
            bearerToken = token,
        ) ?: JSONObject()
    }

    fun claimPersonalTextJob(): JSONObject? =
        post(
            path = "/api/inference/text/jobs/claim",
            body = JSONObject()
                .put("workerId", preferences.nodeId)
                .put("personalOnly", true),
            bearerToken = requireNodeToken(),
        )

    fun completeTextJob(
        jobId: String,
        generation: LocalGeneration,
    ): JSONObject? =
        post(
            path = "/api/inference/text/jobs/complete",
            body = JSONObject()
                .put("jobId", jobId)
                .put("workerId", preferences.nodeId)
                .put("text", generation.text)
                .put("model", generation.modelId)
                .put("provider", "cooperative-android-litertlm")
                .put("latencyMs", generation.latencyMs)
                .put("webSearchUsed", false)
                .put("webAccessMode", "off"),
            bearerToken = requireNodeToken(),
        )

    fun failTextJob(
        jobId: String,
        detail: String,
    ): JSONObject? =
        post(
            path = "/api/inference/text/jobs/complete",
            body = JSONObject()
                .put("jobId", jobId)
                .put("workerId", preferences.nodeId)
                .put("error", detail.take(1000)),
            bearerToken = requireNodeToken(),
        )

    private fun requireNodeToken(): String =
        tokenStore.getNodeToken()
            ?: error("This Android node has not been paired yet.")

    private fun post(
        path: String,
        body: JSONObject,
        bearerToken: String?,
    ): JSONObject? {
        val connection = (URL("$baseUrl$path").openConnection() as HttpURLConnection)
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 120_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            if (!bearerToken.isNullOrBlank()) {
                connection.setRequestProperty("Authorization", "Bearer $bearerToken")
            }

            connection.outputStream.use { output ->
                output.write(body.toString().toByteArray(Charsets.UTF_8))
            }

            val status = connection.responseCode
            if (status == HttpURLConnection.HTTP_NO_CONTENT) return null

            val stream = if (status in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val response = if (text.isBlank()) JSONObject() else JSONObject(text)

            if (status !in 200..299) {
                val message = response.optString("error")
                    .ifBlank { "CoOperative request failed with HTTP $status." }
                error(message)
            }

            return response
        } finally {
            connection.disconnect()
        }
    }
}
