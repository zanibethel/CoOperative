package app.cooperative.localai

/**
 * Stable boundary for on-device model runtimes.
 *
 * APK alpha 1 intentionally leaves the engine unavailable until the first
 * physical phone reports its hardware. The next phase can plug LiteRT-LM (or
 * another qualified runtime) into this interface without changing the UI,
 * node identity, pairing, or CoOperative routing contract.
 */
interface LocalInferenceEngine {
    val isAvailable: Boolean
    val modelId: String?

    fun generate(
        messages: List<LocalMessage>,
        maxTokens: Int = 384,
        temperature: Float = 0.2f,
    ): LocalGeneration
}

data class LocalMessage(
    val role: String,
    val content: String,
)

data class LocalGeneration(
    val text: String,
    val modelId: String,
    val latencyMs: Long,
)

class UnavailableLocalInferenceEngine : LocalInferenceEngine {
    override val isAvailable = false
    override val modelId: String? = null

    override fun generate(
        messages: List<LocalMessage>,
        maxTokens: Int,
        temperature: Float,
    ): LocalGeneration {
        error("No on-device model is installed yet.")
    }
}
