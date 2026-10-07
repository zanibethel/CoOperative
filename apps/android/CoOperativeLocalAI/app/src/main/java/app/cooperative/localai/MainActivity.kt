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
import java.time.Instant
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var preferences: NodePreferences
    private lateinit var tokenStore: SecureTokenStore
    private lateinit var api: CooperativeApi
    private lateinit var modelManager: LocalModelManager
    private lateinit var updateManager: AppUpdateManager

    private lateinit var statusText: TextView
    private lateinit var nodeToggle: Button
    private lateinit var pairingInput: EditText
    private lateinit var pairButton: Button
    private lateinit var hardwareText: TextView
    private lateinit var updateStatusText: TextView
    private lateinit var updateButton: Button
    private lateinit var localModelText: TextView
    private lateinit var downloadModelButton: Button
    private lateinit var selfTestButton: Button
    private lateinit var qualityModelText: TextView
    private lateinit var downloadQualityModelButton: Button
    private lateinit var benchmarkQualityButton: Button
    private lateinit var localPromptInput: EditText
    private lateinit var runLocalButton: Button
    private lateinit var localOutputText: TextView

    private var latestUpdate: AppUpdateInfo? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        preferences = NodePreferences(this)
        tokenStore = SecureTokenStore(this)
        api = CooperativeApi(this, preferences, tokenStore)
        modelManager = LocalModelManager(this)
        updateManager = AppUpdateManager(this)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 100)
        }

        setContentView(buildUi())
        refreshUi()

        if (preferences.nodeEnabled && tokenStore.getNodeToken() != null) {
            startNodeService()
        }

        checkForUpdates()
    }

    override fun onResume() {
        super.onResume()
        if (::updateManager.isInitialized && updateManager.installPendingIfAllowed()) {
            if (::updateStatusText.isInitialized) {
                updateStatusText.text = "Opening Android installer…"
            }
        }
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

        column.addView(sectionTitle("APP UPDATES"))
        updateStatusText = text(
            "Installed: ${BuildConfig.VERSION_NAME} • Checking for updates…",
            14f,
            color = Color.LTGRAY,
        )
        column.addView(updateStatusText)

        updateButton = Button(this).apply {
            text = "Check for updates"
            setOnClickListener {
                val update = latestUpdate
                if (update != null && updateManager.isUpdateAvailable(update)) {
                    downloadAppUpdate(update)
                } else {
                    checkForUpdates()
                }
            }
        }
        column.addView(updateButton.withTop(dp(8)))

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
        localModelText = text("", 14f, color = Color.LTGRAY)
        column.addView(localModelText)

        downloadModelButton = Button(this).apply {
            setOnClickListener { downloadStarterModel() }
        }
        column.addView(downloadModelButton.withTop(dp(10)))

        selfTestButton = Button(this).apply {
            text = "Run fast-model self-test"
            setOnClickListener { runSelfTest() }
        }
        column.addView(selfTestButton.withTop(dp(8)))

        qualityModelText = text("", 14f, color = Color.LTGRAY).withTop(dp(18))
        column.addView(qualityModelText)

        downloadQualityModelButton = Button(this).apply {
            setOnClickListener { downloadQualityModel() }
        }
        column.addView(downloadQualityModelButton.withTop(dp(8)))

        benchmarkQualityButton = Button(this).apply {
            text = "Benchmark quality model (GPU + CPU)"
            setOnClickListener { benchmarkQualityModel() }
        }
        column.addView(benchmarkQualityButton.withTop(dp(8)))

        localPromptInput = EditText(this).apply {
            hint = "Ask the local model something"
            setHintTextColor(Color.GRAY)
            setTextColor(Color.WHITE)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            minLines = 2
            maxLines = 5
        }
        column.addView(localPromptInput.matchWidth().withTop(dp(12)))

        runLocalButton = Button(this).apply {
            text = "Run locally"
            setOnClickListener { runLocalPrompt() }
        }
        column.addView(runLocalButton.withTop(dp(8)))

        localOutputText = text("", 14f, color = Color.rgb(206, 235, 242))
            .withTop(dp(10))
        column.addView(localOutputText)

        column.addView(sectionTitle("DEVICE ASSIST"))
        column.addView(text(
            "Screen understanding and Android Accessibility actions are still disabled in this alpha. " +
                "Local text inference and reliable app updates are being validated first; " +
                "screen-assist permissions come next and remain separately controlled.",
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
            enabled && preferences.qualityModelVerified ->
                "Paired • node enabled • quality reasoning ready"
            enabled && preferences.localModelVerified ->
                "Paired • node enabled • local AI ready"
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

        val installed = modelManager.isStarterModelInstalled
        localModelText.text = when {
            preferences.localModelVerified ->
                "Verified: Qwen3 0.6B INT4 • CPU • ${preferences.localModelLatencyMs} ms self-test"
            installed ->
                "Qwen3 0.6B INT4 is downloaded (~347 MB). Run the self-test before routing jobs."
            else ->
                "Starter profile: Qwen3 0.6B INT4 (~347 MB). Downloaded separately so APK updates stay small."
        }

        downloadModelButton.text =
            if (installed) "Starter model downloaded" else "Download local model (~347 MB)"
        downloadModelButton.isEnabled = !installed

        selfTestButton.isEnabled = installed

        val qualityInstalled = modelManager.isInstalled(LocalModelProfile.QUALITY)
        qualityModelText.text = when {
            preferences.qualityModelVerified ->
                "Quality: Qwen3 1.7B INT4 • ${preferences.qualityModelBackend.uppercase()} • " +
                    "${preferences.qualityModelLatencyMs} ms benchmark"
            qualityInstalled ->
                "Quality: Qwen3 1.7B INT4 (~932 MB) downloaded. Benchmark GPU + CPU to enable image-job reasoning."
            else ->
                "Quality node model: Qwen3 1.7B INT4 (~932 MB). Used for image planning, prompt refinement, and repair reasoning."
        }

        downloadQualityModelButton.text =
            if (qualityInstalled) "Quality model downloaded" else "Download quality model (~932 MB)"
        downloadQualityModelButton.isEnabled = !qualityInstalled
        benchmarkQualityButton.isEnabled = qualityInstalled
        runLocalButton.isEnabled =
            preferences.localModelVerified || preferences.qualityModelVerified
    }

    private fun checkForUpdates() {
        updateButton.isEnabled = false
        updateButton.text = "Checking…"
        updateStatusText.text = "Installed: ${BuildConfig.VERSION_NAME} • Checking for updates…"

        thread(name = "CoOperativeUpdateCheck") {
            try {
                val info = updateManager.checkForUpdate()
                latestUpdate = info

                runOnUiThread {
                    updateButton.isEnabled = true
                    if (updateManager.isUpdateAvailable(info)) {
                        updateStatusText.text = buildString {
                            append("Installed: ").append(BuildConfig.VERSION_NAME)
                            append("\nAvailable: ").append(info.versionName)
                            if (info.notes.isNotBlank()) {
                                append("\n").append(info.notes)
                            }
                        }
                        updateButton.text = "Download update"
                    } else {
                        updateStatusText.text =
                            "Installed: ${BuildConfig.VERSION_NAME} • Up to date"
                        updateButton.text = "Check for updates"
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    updateButton.isEnabled = true
                    updateButton.text = "Check for updates"
                    updateStatusText.text =
                        "Installed: ${BuildConfig.VERSION_NAME}\n" +
                            "Could not check: ${error.message.orEmpty().take(100)}"
                }
            }
        }
    }

    private fun downloadAppUpdate(info: AppUpdateInfo) {
        updateButton.isEnabled = false
        updateButton.text = "Downloading…"
        updateStatusText.text = "Downloading ${info.versionName}…"

        updateManager.downloadUpdate(
            info = info,
            onProgress = { progress ->
                val downloadedMb = progress.downloadedBytes / (1024L * 1024L)
                val totalMb = progress.totalBytes?.div(1024L * 1024L)
                runOnUiThread {
                    updateStatusText.text =
                        if (totalMb != null && totalMb > 0L) {
                            "Downloading ${info.versionName}: $downloadedMb / $totalMb MB"
                        } else {
                            "Downloading ${info.versionName}: $downloadedMb MB"
                        }
                }
            },
            onReady = { uri ->
                runOnUiThread {
                    updateButton.isEnabled = true
                    updateButton.text = "Check for updates"
                    if (updateManager.requestInstall(uri)) {
                        updateStatusText.text = "Download complete • opening Android installer…"
                    } else {
                        updateStatusText.text =
                            "Download complete • allow installs from CoOperativeLocalAI, then return here."
                    }
                }
            },
            onError = { error ->
                runOnUiThread {
                    updateButton.isEnabled = true
                    updateButton.text = "Download update"
                    updateStatusText.text =
                        "Update download failed: ${error.message.orEmpty().take(120)}"
                }
            },
        )
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
        startNodeService()
        refreshUi()
    }

    private fun startNodeService() {
        val intent = Intent(this, NodeForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun downloadStarterModel() {
        downloadModelButton.isEnabled = false
        selfTestButton.isEnabled = false
        localOutputText.text = ""
        localModelText.text = "Starting model download…"

        thread(name = "CoOperativeModelDownload") {
            try {
                modelManager.downloadStarterModel { progress ->
                    val downloadedMb = progress.downloadedBytes / (1024L * 1024L)
                    val totalMb = progress.totalBytes?.div(1024L * 1024L)
                    runOnUiThread {
                        localModelText.text =
                            if (totalMb != null && totalMb > 0) {
                                "Downloading local model: $downloadedMb / $totalMb MB"
                            } else {
                                "Downloading local model: $downloadedMb MB"
                            }
                    }
                }
                preferences.clearLocalModelVerification()
                runOnUiThread {
                    refreshUi("Model downloaded • run local self-test")
                }
            } catch (error: Exception) {
                runOnUiThread {
                    downloadModelButton.isEnabled = true
                    refreshUi("Model download failed: ${error.message.orEmpty().take(120)}")
                }
            }
        }
    }

    private fun downloadQualityModel() {
        downloadQualityModelButton.isEnabled = false
        benchmarkQualityButton.isEnabled = false
        localOutputText.text = ""
        qualityModelText.text = "Starting Qwen3 1.7B quality-model download…"

        thread(name = "CoOperativeQualityModelDownload") {
            try {
                modelManager.downloadModel(LocalModelProfile.QUALITY) { progress ->
                    val downloadedMb = progress.downloadedBytes / (1024L * 1024L)
                    val totalMb = progress.totalBytes?.div(1024L * 1024L)
                    runOnUiThread {
                        qualityModelText.text =
                            if (totalMb != null && totalMb > 0) {
                                "Downloading Qwen3 1.7B: $downloadedMb / $totalMb MB"
                            } else {
                                "Downloading Qwen3 1.7B: $downloadedMb MB"
                            }
                    }
                }
                preferences.clearQualityModelVerification()
                runOnUiThread {
                    refreshUi("Quality model downloaded • benchmark GPU + CPU")
                }
            } catch (error: Exception) {
                runOnUiThread {
                    downloadQualityModelButton.isEnabled = true
                    refreshUi(
                        "Quality model download failed: ${error.message.orEmpty().take(120)}",
                    )
                }
            }
        }
    }

    private fun benchmarkQualityModel() {
        benchmarkQualityButton.isEnabled = false
        downloadQualityModelButton.isEnabled = false
        localOutputText.text = ""
        qualityModelText.text =
            "Benchmarking Qwen3 1.7B on GPU first, then CPU…"

        thread(name = "CoOperativeQualityBenchmark") {
            val engine = LiteRtLocalInferenceEngine(this)
            try {
                val results = mutableListOf<LocalGeneration>()
                var gpuError: String? = null
                try {
                    results += engine.benchmark(
                        profile = LocalModelProfile.QUALITY,
                        backendName = "gpu",
                    )
                } catch (error: Throwable) {
                    gpuError = error.message.orEmpty().take(120)
                }

                try {
                    results += engine.benchmark(
                        profile = LocalModelProfile.QUALITY,
                        backendName = "cpu",
                    )
                } catch (_: Throwable) {
                    // If GPU worked, CPU failure should not invalidate the quality model.
                }

                val best = results.minByOrNull { it.latencyMs }
                    ?: error(
                        "Qwen3 1.7B failed on both GPU and CPU" +
                            (gpuError?.let { ": $it" } ?: "."),
                    )

                preferences.qualityModelVerified = true
                preferences.qualityModelId = best.modelId
                preferences.qualityModelLatencyMs = best.latencyMs
                preferences.qualityModelBackend = best.backend
                preferences.qualityModelVerifiedAt = Instant.now().toString()

                if (tokenStore.getNodeToken() != null) {
                    runCatching { api.heartbeat() }
                }

                val detail = results.joinToString(" • ") {
                    "${it.backend.uppercase()} ${it.latencyMs} ms"
                }
                runOnUiThread {
                    localOutputText.text =
                        "Quality benchmark complete: $detail\nSelected: ${best.backend.uppercase()}"
                    refreshUi(
                        "Quality reasoning verified • ${best.backend.uppercase()} selected",
                    )
                    if (preferences.nodeEnabled) startNodeService()
                }
            } catch (error: Throwable) {
                preferences.clearQualityModelVerification()
                runOnUiThread {
                    refreshUi(
                        "Quality benchmark failed: ${error.message.orEmpty().take(140)}",
                    )
                }
            } finally {
                engine.close()
                runOnUiThread {
                    refreshUi()
                }
            }
        }
    }

    private fun runSelfTest() {
        selfTestButton.isEnabled = false
        runLocalButton.isEnabled = false
        localOutputText.text = ""
        localModelText.text = "Loading model and running local self-test…"

        thread(name = "CoOperativeLocalSelfTest") {
            val engine = LiteRtLocalInferenceEngine(this)
            try {
                val result = engine.generate(
                    listOf(
                        LocalMessage(
                            role = "user",
                            content = "Reply with one short sentence confirming local Android AI is running.",
                        ),
                    ),
                )
                preferences.localModelVerified = true
                preferences.localModelId = result.modelId
                preferences.localModelLatencyMs = result.latencyMs
                preferences.localModelVerifiedAt = Instant.now().toString()

                if (tokenStore.getNodeToken() != null) {
                    runCatching { api.heartbeat() }
                }

                runOnUiThread {
                    localOutputText.text = result.text
                    refreshUi("Local AI verified • ${result.latencyMs} ms")
                    if (preferences.nodeEnabled) startNodeService()
                }
            } catch (error: Exception) {
                preferences.clearLocalModelVerification()
                runOnUiThread {
                    refreshUi("Local self-test failed: ${error.message.orEmpty().take(140)}")
                }
            } finally {
                engine.close()
                runOnUiThread {
                    selfTestButton.isEnabled = modelManager.isStarterModelInstalled
                    runLocalButton.isEnabled =
                        preferences.localModelVerified || preferences.qualityModelVerified
                }
            }
        }
    }

    private fun runLocalPrompt() {
        val prompt = localPromptInput.text.toString().trim()
        if (prompt.isBlank()) {
            localOutputText.text = "Enter a prompt first."
            return
        }

        runLocalButton.isEnabled = false
        localOutputText.text = "Running entirely on this phone…"

        thread(name = "CoOperativeLocalPrompt") {
            val engine = LiteRtLocalInferenceEngine(this)
            try {
                val profile =
                    if (preferences.qualityModelVerified) {
                        LocalModelProfile.QUALITY
                    } else {
                        LocalModelProfile.FAST
                    }
                val backend =
                    if (profile == LocalModelProfile.QUALITY) {
                        preferences.qualityModelBackend.ifBlank { "cpu" }
                    } else {
                        "cpu"
                    }
                val result = engine.generate(
                    messages = listOf(LocalMessage(role = "user", content = prompt)),
                    profile = profile,
                    preferredBackend = backend,
                )
                runOnUiThread {
                    localOutputText.text = "${result.text}\n\n${result.latencyMs} ms"
                }
            } catch (error: Exception) {
                runOnUiThread {
                    localOutputText.text =
                        "Local generation failed: ${error.message.orEmpty().take(180)}"
                }
            } finally {
                engine.close()
                runOnUiThread {
                    runLocalButton.isEnabled =
                        preferences.localModelVerified || preferences.qualityModelVerified
                }
            }
        }
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
