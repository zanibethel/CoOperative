package app.cooperative.localai

import android.content.Context
import android.os.Build
import java.util.Locale
import java.util.UUID

class NodePreferences(context: Context) {
    private val preferences =
        context.getSharedPreferences("cooperative_node", Context.MODE_PRIVATE)

    val nodeId: String
        get() {
            val existing = preferences.getString(KEY_NODE_ID, null)
            if (!existing.isNullOrBlank()) return existing

            val generated = "android-" +
                UUID.randomUUID().toString().lowercase(Locale.US)
            preferences.edit().putString(KEY_NODE_ID, generated).apply()
            return generated
        }

    var displayName: String
        get() = preferences.getString(KEY_DISPLAY_NAME, null)
            ?: defaultDisplayName()
        set(value) {
            preferences.edit()
                .putString(KEY_DISPLAY_NAME, value.take(160))
                .apply()
        }

    var ownerRef: String
        get() = preferences.getString(KEY_OWNER_REF, "platform-private")
            ?: "platform-private"
        set(value) {
            preferences.edit().putString(KEY_OWNER_REF, value.take(160)).apply()
        }

    var nodeClass: String
        get() = preferences.getString(KEY_NODE_CLASS, "private") ?: "private"
        set(value) {
            preferences.edit().putString(KEY_NODE_CLASS, value).apply()
        }

    var nodeEnabled: Boolean
        get() = preferences.getBoolean(KEY_NODE_ENABLED, false)
        set(value) {
            preferences.edit().putBoolean(KEY_NODE_ENABLED, value).apply()
        }

    var localModelVerified: Boolean
        get() = preferences.getBoolean(KEY_LOCAL_MODEL_VERIFIED, false)
        set(value) {
            preferences.edit().putBoolean(KEY_LOCAL_MODEL_VERIFIED, value).apply()
        }

    var localModelId: String
        get() = preferences.getString(KEY_LOCAL_MODEL_ID, "") ?: ""
        set(value) {
            preferences.edit().putString(KEY_LOCAL_MODEL_ID, value.take(240)).apply()
        }

    var localModelLatencyMs: Long
        get() = preferences.getLong(KEY_LOCAL_MODEL_LATENCY_MS, 0L)
        set(value) {
            preferences.edit().putLong(KEY_LOCAL_MODEL_LATENCY_MS, value.coerceAtLeast(0L)).apply()
        }

    var localModelVerifiedAt: String
        get() = preferences.getString(KEY_LOCAL_MODEL_VERIFIED_AT, "") ?: ""
        set(value) {
            preferences.edit().putString(KEY_LOCAL_MODEL_VERIFIED_AT, value.take(80)).apply()
        }

    fun clearLocalModelVerification() {
        preferences.edit()
            .putBoolean(KEY_LOCAL_MODEL_VERIFIED, false)
            .remove(KEY_LOCAL_MODEL_ID)
            .remove(KEY_LOCAL_MODEL_LATENCY_MS)
            .remove(KEY_LOCAL_MODEL_VERIFIED_AT)
            .apply()
    }

    private fun defaultDisplayName(): String {
        val manufacturer = Build.MANUFACTURER.orEmpty()
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
        val model = Build.MODEL.orEmpty()
        return "$manufacturer $model".trim().ifBlank { "Android CoOperative Node" }
    }

    companion object {
        private const val KEY_NODE_ID = "node_id"
        private const val KEY_DISPLAY_NAME = "display_name"
        private const val KEY_OWNER_REF = "owner_ref"
        private const val KEY_NODE_CLASS = "node_class"
        private const val KEY_NODE_ENABLED = "node_enabled"
        private const val KEY_LOCAL_MODEL_VERIFIED = "local_model_verified"
        private const val KEY_LOCAL_MODEL_ID = "local_model_id"
        private const val KEY_LOCAL_MODEL_LATENCY_MS = "local_model_latency_ms"
        private const val KEY_LOCAL_MODEL_VERIFIED_AT = "local_model_verified_at"
    }
}
