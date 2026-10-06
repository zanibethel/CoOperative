package app.cooperative.localai

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.SamplerConfig

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

class LiteRtLocalInferenceEngine(
    private val context: Context,
) : LocalInferenceEngine, AutoCloseable {
    private val modelManager = LocalModelManager(context)
    private var engine: Engine? = null

    override val isAvailable: Boolean
        get() = modelManager.isStarterModelInstalled

    override val modelId: String
        get() = LocalModelCatalog.STARTER_MODEL_ID

    @Synchronized
    private fun ensureEngine(): Engine {
        engine?.let { return it }
        if (!modelManager.isStarterModelInstalled) {
            error("The local model has not been downloaded yet.")
        }

        val config = EngineConfig(
            modelPath = modelManager.starterModelFile.absolutePath,
            backend = Backend.CPU(threadCount = 6),
            cacheDir = context.cacheDir.absolutePath,
        )
        return Engine(config).also {
            it.initialize()
            engine = it
        }
    }

    override fun generate(
        messages: List<LocalMessage>,
        maxTokens: Int,
        temperature: Float,
    ): LocalGeneration {
        val prompt = formatMessages(messages)
        if (prompt.isBlank()) error("Local generation requires at least one message.")

        val config = ConversationConfig(
            samplerConfig = SamplerConfig(
                topK = 40,
                topP = 0.95,
                temperature = temperature.toDouble(),
            ),
        )

        val started = System.currentTimeMillis()
        val response = ensureEngine().createConversation(config).use { conversation ->
            conversation.sendMessage(
                text = prompt,
                maxOutputToken = maxTokens.coerceIn(16, 768),
            )
        }
        val text = response.toString().trim()
        if (text.isBlank()) error("The local model returned an empty response.")

        return LocalGeneration(
            text = text,
            modelId = modelId,
            latencyMs = System.currentTimeMillis() - started,
        )
    }

    private fun formatMessages(messages: List<LocalMessage>): String {
        val clean = messages
            .filter { it.content.isNotBlank() }
            .takeLast(30)

        return buildString {
            append(
                "You are the local CoOperative assistant running privately on this Android device. " +
                    "Answer the latest user request directly and concisely.\n\n",
            )
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

    override fun close() {
        synchronized(this) {
            engine?.close()
            engine = null
        }
    }
}
