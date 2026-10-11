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
        val fastVerified = preferences.localModelVerified
        val qualityVerified = preferences.qualityModelVerified
        val verified = fastVerified || qualityVerified

        val capabilities = JSONArray()
            .put("android_node")
            .put("local_chat_client")
            .put("device_runtime_alpha")
        if (verified) {
            capabilities
                .put("local_text_generation")
                .put("text_generation")
        }
        if (qualityVerified) {
            capabilities
                .put("media_prompt_planning_v1")
                .put("cross_device_media_planning")
                .put("quality_text_reasoning")
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
            val benchmarks = JSONArray()
            if (fastVerified) {
                benchmarks.put(
                    JSONObject()
                        .put("profile", "fast")
                        .put("model", preferences.localModelId)
                        .put("provider", "cooperative-android-litertlm")
                        .put("backend", "cpu")
                        .put("latencyMs", preferences.localModelLatencyMs)
                        .put("recordedAt", preferences.localModelVerifiedAt),
                )
            }
            if (qualityVerified) {
                benchmarks.put(
                    JSONObject()
                        .put("profile", "quality")
                        .put("model", preferences.qualityModelId)
                        .put("provider", "cooperative-android-litertlm")
                        .put("backend", preferences.qualityModelBackend)
                        .put("latencyMs", preferences.qualityModelLatencyMs)
                        .put("recordedAt", preferences.qualityModelVerifiedAt),
                )
            }

            resources.put(
                "textModelPlan",
                JSONObject()
                    .put("revision", "android-alpha05")
                    .put(
                        "backend",
                        if (qualityVerified) {
                            "litertlm-${preferences.qualityModelBackend.ifBlank { "cpu" }}"
                        } else {
                            "litertlm-cpu"
                        },
                    )
                    .put(
                        "models",
                        JSONObject()
                            .put(
                                "fast",
                                if (fastVerified) preferences.localModelId else "",
                            )
                            .put(
                                "quality",
                                if (qualityVerified) preferences.qualityModelId else "",
                            )
                            .put("heavy", "")
                            .put("vision", ""),
                    )
                    .put(
                        "selectionReason",
                        if (qualityVerified) {
                            "Qwen3 1.7B is the verified image-planning and reasoning tier; fast Qwen3 0.6B remains available for lighter text work."
                        } else {
                            "Fast local text tier is verified; quality image-planning tier is not benchmarked yet."
                        },
                    ),
            )
            resources.put("textBenchmarks", benchmarks)
            if (qualityVerified) {
                resources.put(
                    "textBenchmark",
                    JSONObject()
                        .put("profile", "quality")
                        .put("model", preferences.qualityModelId)
                        .put("provider", "cooperative-android-litertlm")
                        .put("backend", preferences.qualityModelBackend)
                        .put("latencyMs", preferences.qualityModelLatencyMs)
                        .put("recordedAt", preferences.qualityModelVerifiedAt),
                )
            } else if (fastVerified) {
                resources.put(
                    "textBenchmark",
                    JSONObject()
                        .put("profile", "fast")
                        .put("model", preferences.localModelId)
                        .put("provider", "cooperative-android-litertlm")
                        .put("backend", "cpu")
                        .put("latencyMs", preferences.localModelLatencyMs)
                        .put("recordedAt", preferences.localModelVerifiedAt),
                )
            }
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
            .put("workerVersion", "android-local-ai-0.5.3")

        return post(
            path = "/api/unison/nodes/heartbeat",
            body = payload,
            bearerToken = token,
        ) ?: JSONObject()
    }

    fun claimTextJob(): JSONObject? =
        claimPersonalTextJob() ?: claimMediaPlanningTextJob()

    private fun claimPersonalTextJob(): JSONObject? =
        post(
            path = "/api/inference/text/jobs/claim",
            body = JSONObject()
                .put("workerId", preferences.nodeId)
                .put("personalOnly", true),
            bearerToken = requireNodeToken(),
        )

    private fun claimMediaPlanningTextJob(): JSONObject? =
        post(
            path = "/api/inference/text/jobs/claim",
            body = JSONObject()
                .put("workerId", preferences.nodeId)
                .put("planningOnly", true),
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
