package app.cooperative.localai

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.SamplerConfig

interface LocalInferenceEngine {
    val isAvailable: Boolean

    fun generate(
        messages: List<LocalMessage>,
        maxTokens: Int = 384,
        temperature: Float = 0.2f,
        profile: LocalModelProfile = LocalModelProfile.FAST,
        preferredBackend: String? = null,
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
    val backend: String,
    val profile: String,
)

class LiteRtLocalInferenceEngine(
    private val context: Context,
) : LocalInferenceEngine, AutoCloseable {
    private val modelManager = LocalModelManager(context)
    private var engine: Engine? = null
    private var loadedProfile: LocalModelProfile? = null
    private var loadedBackend: String? = null

    override val isAvailable: Boolean
        get() =
            modelManager.isInstalled(LocalModelProfile.FAST) ||
                modelManager.isInstalled(LocalModelProfile.QUALITY)

    private fun backendFor(name: String): Backend =
        when (name.lowercase()) {
            "gpu" -> Backend.GPU()
            else -> Backend.CPU(threadCount = 6)
        }

    @Synchronized
    private fun ensureEngine(
        profile: LocalModelProfile,
        backendName: String,
    ): Engine {
        engine?.let {
            if (loadedProfile == profile && loadedBackend == backendName) {
                return it
            }
        }

        closeEngine()

        if (!modelManager.isInstalled(profile)) {
            error("${LocalModelCatalog.spec(profile).id} has not been downloaded yet.")
        }

        val config = EngineConfig(
            modelPath = modelManager.modelFile(profile).absolutePath,
            backend = backendFor(backendName),
            cacheDir = context.cacheDir.absolutePath,
        )

        return Engine(config).also {
            it.initialize()
            engine = it
            loadedProfile = profile
            loadedBackend = backendName
        }
    }

    override fun generate(
        messages: List<LocalMessage>,
        maxTokens: Int,
        temperature: Float,
        profile: LocalModelProfile,
        preferredBackend: String?,
    ): LocalGeneration {
        val prompt = formatMessages(messages, profile)
        if (prompt.isBlank()) error("Local generation requires at least one message.")

        val preferred = preferredBackend
            ?.trim()
            ?.lowercase()
            ?.takeIf { it == "gpu" || it == "cpu" }
            ?: "cpu"

        val backends = if (preferred == "gpu") listOf("gpu", "cpu") else listOf("cpu")
        var lastError: Throwable? = null

        for (backendName in backends) {
            try {
                return generateWithBackend(
                    prompt = prompt,
                    maxTokens = maxTokens,
                    temperature = temperature,
                    profile = profile,
                    backendName = backendName,
                )
            } catch (error: Throwable) {
                lastError = error
                closeEngine()
            }
        }

        throw IllegalStateException(
            lastError?.message ?: "Local LiteRT-LM inference failed.",
            lastError,
        )
    }

    fun benchmark(
        profile: LocalModelProfile,
        backendName: String,
        maxTokens: Int = 96,
    ): LocalGeneration =
        generate(
            messages = listOf(
                LocalMessage(
                    role = "user",
                    content =
                        "Return one concise JSON object describing an image composition plan with subject, camera, lighting, anatomy risks, and background.",
                ),
            ),
            maxTokens = maxTokens,
            temperature = 0.1f,
            profile = profile,
            preferredBackend = backendName,
        )

    private fun generateWithBackend(
        prompt: String,
        maxTokens: Int,
        temperature: Float,
        profile: LocalModelProfile,
        backendName: String,
    ): LocalGeneration {
        val spec = LocalModelCatalog.spec(profile)
        val config = ConversationConfig(
            samplerConfig = SamplerConfig(
                topK = 40,
                topP = 0.95,
                temperature = temperature.toDouble(),
            ),
        )

        val started = System.currentTimeMillis()
        val response = ensureEngine(profile, backendName)
            .createConversation(config)
            .use { conversation ->
                conversation.sendMessage(
                    text = prompt,
                    maxOutputToken = maxTokens.coerceIn(16, 1024),
                )
            }

        val text = response.toString().trim()
        if (text.isBlank()) error("The local model returned an empty response.")

        return LocalGeneration(
            text = text,
            modelId = spec.id,
            latencyMs = System.currentTimeMillis() - started,
            backend = backendName,
            profile = profile.name.lowercase(),
        )
    }

    private fun formatMessages(
        messages: List<LocalMessage>,
        profile: LocalModelProfile,
    ): String {
        val clean = messages
            .filter { it.content.isNotBlank() }
            .takeLast(30)

        return buildString {
            if (profile == LocalModelProfile.QUALITY) {
                append(
                    "You are the CoOperative quality reasoning specialist running privately on this Android node. " +
                        "Preserve user intent, reason carefully about composition and likely image-generation failure modes, " +
                        "and return the requested answer directly and compactly.\n\n",
                )
            } else {
                append(
                    "You are the local CoOperative assistant running privately on this Android device. " +
                        "Answer the latest user request directly and concisely.\n\n",
                )
            }

            for (message in clean) {
                val role = when (message.role.lowercase()) {
                    "system" -> "SYSTEM"
                    "assistant", "model" -> "ASSISTANT"
                    else -> "USER"
                }
                append(role)
                append(": ")
                append(message.content.trim().take(12000))
                append("\n")
            }
            append("ASSISTANT:")
        }
    }

    @Synchronized
    private fun closeEngine() {
        engine?.close()
        engine = null
        loadedProfile = null
        loadedBackend = null
    }

    override fun close() {
        closeEngine()
    }
}
