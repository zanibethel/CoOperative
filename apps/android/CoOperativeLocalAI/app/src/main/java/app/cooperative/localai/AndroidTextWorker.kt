package app.cooperative.localai

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class AndroidTextWorker(
    context: Context,
    private val api: CooperativeApi,
) : AutoCloseable {
    private val engine = LiteRtLocalInferenceEngine(context)
    private val preferences = NodePreferences(context)

    fun pollOnce(): Boolean {
        if (!engine.isAvailable) return false

        val job = api.claimTextJob() ?: return false
        val jobId = job.optString("jobId")
        if (jobId.isBlank()) return false

        try {
            val capability = job.optString("capability", "text")
            val attachments = job.optJSONArray("attachmentIds") ?: JSONArray()
            if (capability != "text" || attachments.length() > 0) {
                api.failTextJob(
                    jobId,
                    "This Android alpha supports text-only personal and media-planning inference.",
                )
                return true
            }

            val messages = parseMessages(job.optJSONArray("messages") ?: JSONArray())
            if (messages.isEmpty()) {
                api.failTextJob(jobId, "Claimed text job contained no usable messages.")
                return true
            }

            val maxTokens = job.optInt("maxTokens", 384).coerceIn(16, 1024)
            val temperature = job.optDouble("temperature", 0.2)
                .toFloat()
                .coerceIn(0f, 1.5f)
            val routingMode = job.optString("routingMode")
            val taskClass = job.optString("taskClass")
            val mediaPlanning =
                routingMode == "cross-device-media-planning-v1" ||
                    taskClass == "media-planning"
            val profile =
                when {
                    mediaPlanning && preferences.qualityModelVerified ->
                        LocalModelProfile.QUALITY
                    preferences.localModelVerified ->
                        LocalModelProfile.FAST
                    preferences.qualityModelVerified ->
                        LocalModelProfile.QUALITY
                    else ->
                        LocalModelProfile.FAST
                }
            val backend =
                if (profile == LocalModelProfile.QUALITY) {
                    preferences.qualityModelBackend.ifBlank { "cpu" }
                } else {
                    "cpu"
                }

            val generation = engine.generate(
                messages = messages,
                maxTokens = maxTokens,
                temperature = temperature,
                profile = profile,
                preferredBackend = backend,
            )
            api.completeTextJob(jobId, generation)
        } catch (error: Exception) {
            api.failTextJob(
                jobId,
                error.message.orEmpty().ifBlank { "Local Android inference failed." },
            )
        }

        return true
    }

    private fun parseMessages(array: JSONArray): List<LocalMessage> {
        val result = mutableListOf<LocalMessage>()
        for (index in 0 until array.length()) {
            val value = array.opt(index)
            if (value !is JSONObject) continue
            val role = value.optString("role")
            val content = value.optString("content")
            if (role.isBlank() || content.isBlank()) continue
            result += LocalMessage(role = role, content = content)
        }
        return result
    }

    override fun close() {
        engine.close()
    }
}
