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
    }
}
