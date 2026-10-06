package app.cooperative.localai

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.NumberFormat
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var preferences: NodePreferences
    private lateinit var tokenStore: SecureTokenStore
    private lateinit var api: CooperativeApi

    private lateinit var statusText: TextView
    private lateinit var nodeToggle: Button
    private lateinit var pairingInput: EditText
    private lateinit var pairButton: Button
    private lateinit var hardwareText: TextView
    private lateinit var localModelText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        preferences = NodePreferences(this)
        tokenStore = SecureTokenStore(this)
        api = CooperativeApi(this, preferences, tokenStore)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 100)
        }

        setContentView(buildUi())
        refreshUi()
    }

    private fun buildUi(): ScrollView {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.rgb(11, 15, 20))
        }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(28), dp(20), dp(40))
        }

        column.addView(text("CoOperativeLocalAI", 28f, bold = true))
        column.addView(text(
            "Android private node + local AI runtime",
            15f,
            color = Color.rgb(171, 206, 220),
        ).withTop(dp(4)))

        statusText = text("", 16f, bold = true).withTop(dp(28))
        column.addView(statusText)

        hardwareText = text("", 14f, color = Color.LTGRAY).withTop(dp(10))
        column.addView(hardwareText)

        nodeToggle = Button(this).apply {
            setOnClickListener { toggleNode() }
        }
        column.addView(nodeToggle.withTop(dp(18)))

        column.addView(sectionTitle("PAIR THIS PHONE"))
        column.addView(text(
            "Create a one-time Unison pairing code in CoOperative, then enter it here. " +
                "The resulting node credential is encrypted with Android Keystore.",
            14f,
            color = Color.LTGRAY,
        ))

        pairingInput = EditText(this).apply {
            hint = "Pairing code"
            setHintTextColor(Color.GRAY)
            setTextColor(Color.WHITE)
            inputType = InputType.TYPE_CLASS_TEXT
            isSingleLine = true
        }
        column.addView(pairingInput.matchWidth().withTop(dp(10)))

        pairButton = Button(this).apply {
            text = "Pair phone"
            setOnClickListener { pairPhone() }
        }
        column.addView(pairButton.withTop(dp(8)))

        column.addView(sectionTitle("LOCAL MODEL"))
        localModelText = text(
            "Waiting for hardware report. APK alpha 1 does not download a model yet.",
            14f,
            color = Color.LTGRAY,
        )
        column.addView(localModelText)

        column.addView(sectionTitle("DEVICE ASSIST"))
        column.addView(text(
            "Screen understanding, Accessibility actions and MediaProjection are intentionally " +
                "not enabled in this first APK. They will be added behind explicit user controls " +
                "after node + local inference are validated.",
            14f,
            color = Color.LTGRAY,
        ))

        column.addView(sectionTitle("NODE ID"))
        column.addView(text(preferences.nodeId, 12f, color = Color.GRAY))

        scroll.addView(column)
        return scroll
    }

    private fun refreshUi(message: String? = null) {
        val paired = tokenStore.getNodeToken() != null
        val enabled = preferences.nodeEnabled
        val state = when {
            message != null -> message
            !paired -> "Not paired"
            enabled -> "Paired • node enabled"
            else -> "Paired • node stopped"
        }

        statusText.text = state
        nodeToggle.text = if (enabled) "Stop private node" else "Start private node"
        nodeToggle.isEnabled = paired
        pairButton.text = if (paired) "Re-pair phone" else "Pair phone"

        val runtime = Runtime.getRuntime()
        val memoryMb = try {
            val manager = getSystemService(ACTIVITY_SERVICE) as android.app.ActivityManager
            val info = android.app.ActivityManager.MemoryInfo()
            manager.getMemoryInfo(info)
            info.totalMem / (1024L * 1024L)
        } catch (_: Exception) {
            0L
        }

        hardwareText.text = buildString {
            append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
            append("\nAndroid ").append(Build.VERSION.RELEASE)
            append(" • ").append(Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown ABI")
            append("\n")
            append(runtime.availableProcessors()).append(" CPU threads")
            if (memoryMb > 0) {
                append(" • ")
                append(NumberFormat.getIntegerInstance().format(memoryMb))
                append(" MB RAM")
            }
        }
    }

    private fun pairPhone() {
        val code = pairingInput.text.toString().trim()
        if (code.length < 8) {
            refreshUi("Enter the one-time pairing code first.")
            return
        }

        pairButton.isEnabled = false
        refreshUi("Pairing phone…")

        thread(name = "CoOperativePair") {
            try {
                api.pair(code)
                runOnUiThread {
                    pairingInput.setText("")
                    pairButton.isEnabled = true
                    refreshUi("Paired successfully • ready to start node")
                }
            } catch (error: Exception) {
                runOnUiThread {
                    pairButton.isEnabled = true
                    refreshUi("Pairing failed: ${error.message.orEmpty().take(120)}")
                }
            }
        }
    }

    private fun toggleNode() {
        if (tokenStore.getNodeToken() == null) return

        if (preferences.nodeEnabled) {
            preferences.nodeEnabled = false
            stopService(Intent(this, NodeForegroundService::class.java))
            refreshUi()
            return
        }

        preferences.nodeEnabled = true
        val intent = Intent(this, NodeForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        refreshUi()
    }

    private fun sectionTitle(value: String): TextView =
        text(value, 13f, bold = true, color = Color.rgb(111, 219, 242))
            .withTop(dp(30))

    private fun text(
        value: String,
        size: Float,
        bold: Boolean = false,
        color: Int = Color.WHITE,
    ): TextView = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun <T : android.view.View> T.withTop(top: Int): T {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = top }
        return this
    }

    private fun <T : android.view.View> T.matchWidth(): T {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        return this
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
