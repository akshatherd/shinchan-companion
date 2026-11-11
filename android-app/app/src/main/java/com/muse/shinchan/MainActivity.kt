package com.muse.shinchan

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.ContextCompat.startForegroundService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {
    private val prefs by lazy { getSharedPreferences("muse", MODE_PRIVATE) }
    private val scope = CoroutineScope(Dispatchers.Main)
    private val healthClient = OkHttpClient.Builder().callTimeout(5, TimeUnit.SECONDS).build()
    private val checklistRows = mutableMapOf<String, TextView>()
    private lateinit var serverUrl: EditText
    private lateinit var statusText: TextView
    private lateinit var logsText: TextView
    private lateinit var selfTestTarget: TextView
    private var refreshJob: Job? = null
    @Volatile private var selfTestTapReceived = false

    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshChecklist() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
        if (intent?.action == ACTION_VOICE_PROMPT) showVoicePrompt()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_VOICE_PROMPT) showVoicePrompt()
    }

    private fun showVoicePrompt() {
        val input = EditText(this).apply { hint = "Type a message for Shinchan"; minLines = 2 }
        AlertDialog.Builder(this).setTitle("Talk to Shinchan")
            .setView(input).setNegativeButton("Cancel", null)
            .setPositiveButton("Send") { _, _ -> OverlayHolder.service?.submitVoiceText(input.text.toString()) }
            .show()
    }

    override fun onResume() {
        super.onResume()
        refreshChecklist()
        refreshJob?.cancel()
        refreshJob = scope.launch { while (true) { refreshChecklist(); delay(1500) } }
    }

    override fun onPause() {
        refreshJob?.cancel()
        super.onPause()
    }

    private fun buildScreen() {
        val scroll = ScrollView(this)
        scroll.isFillViewport = true
        scroll.fitsSystemWindows = true
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(28)) }
        scroll.addView(content)
        setContentView(R.layout.activity_main)
        findViewById<FrameLayout>(R.id.activityRoot).addView(scroll, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        content.addView(label("Shinchan MUSE", 28f, true))
        content.addView(label("A floating companion. You stay in control of every permission and action.", 14f))
        content.addView(section("Setup checklist"))
        checklistRow(content, "Overlay permission", "overlay") { openOverlaySettings() }
        checklistRow(content, "Accessibility service", "accessibility") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        checklistRow(content, "Notifications", "notifications") { requestNotifications() }
        checklistRow(content, "Microphone", "microphone") { permissionRequest.launch(Manifest.permission.RECORD_AUDIO) }
        checklistRow(content, "Battery optimization", "battery") { openBatterySettings() }
        checklistRow(content, "Server connection", "server") { testConnection() }

        val restricted = card()
        restricted.addView(label("Accessibility greyed out?", 17f, true))
        restricted.addView(label("Open App Info > ⋮ > Allow restricted settings. Android may require this after sideloading.", 14f))
        restricted.addView(button("Open this app's App Info") { openAppInfo() })
        content.addView(restricted)

        content.addView(section("Brain server"))
        serverUrl = EditText(this).apply {
            hint = "ws://192.168.1.20:8000/ws/companion"
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString("serverUrl", "ws://10.0.2.2:8000/ws/companion"))
        }
        content.addView(serverUrl, matchWrap())
        content.addView(label("Emulator: ws://10.0.2.2:8000/ws/companion  ·  USB: ws://localhost:8000/ws/companion after `adb reverse tcp:8000 tcp:8000`. For Wi-Fi, use your computer's LAN IP.", 13f))
        val serverActions = horizontal()
        serverActions.addView(button("Save URL") { saveServerUrl() }, weighted())
        serverActions.addView(button("Test Connection") { testConnection() }, weighted())
        content.addView(serverActions)
        statusText = label("Offline mode is available.", 14f, true)
        content.addView(statusText)

        content.addView(section("Standalone AI fallback"))
        val provider = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("Gemini", "OpenAI"))
            setSelection(if (prefs.getString("llmProvider", "Gemini") == "OpenAI") 1 else 0)
        }
        content.addView(provider, matchWrap())
        val apiKey = EditText(this).apply {
            hint = "Optional Gemini or OpenAI API key"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine(true)
            setText(prefs.getString("llmApiKey", ""))
        }
        content.addView(apiKey, matchWrap())
        content.addView(label("Used on this device when the brain server is offline. Leave blank for private on-device Hinglish replies.", 13f))
        content.addView(button("Save AI fallback settings") {
            prefs.edit().putString("llmProvider", provider.selectedItem.toString()).putString("llmApiKey", apiKey.text.toString().trim()).apply()
            Toast.makeText(this, "AI fallback settings saved", Toast.LENGTH_SHORT).show()
        })

        content.addView(section("Compact overlay size"))
        val sizeRow = horizontal()
        val widthSetting = EditText(this).apply { hint = "Width dp"; inputType = android.text.InputType.TYPE_CLASS_NUMBER; setText(prefs.getInt("overlayWidthDp", OverlayCompanionService.DEFAULT_WIDTH_DP).toString()) }
        val heightSetting = EditText(this).apply { hint = "Height dp"; inputType = android.text.InputType.TYPE_CLASS_NUMBER; setText(prefs.getInt("overlayHeightDp", OverlayCompanionService.DEFAULT_HEIGHT_DP).toString()) }
        sizeRow.addView(widthSetting, weighted()); sizeRow.addView(heightSetting, weighted()); content.addView(sizeRow)
        content.addView(label("Default 180 × 240 dp. The window briefly grows for speech bubbles and permission cards.", 13f))
        content.addView(button("Save overlay size") {
            val width = widthSetting.text.toString().toIntOrNull()?.coerceIn(120, 300) ?: OverlayCompanionService.DEFAULT_WIDTH_DP
            val height = heightSetting.text.toString().toIntOrNull()?.coerceIn(160, 400) ?: OverlayCompanionService.DEFAULT_HEIGHT_DP
            prefs.edit().putInt("overlayWidthDp", width).putInt("overlayHeightDp", height).apply()
            OverlayHolder.service?.resizeWindow(0, 0)
            widthSetting.setText(width.toString()); heightSetting.setText(height.toString())
            Toast.makeText(this, "Overlay size saved", Toast.LENGTH_SHORT).show()
        })

        val actions = horizontal()
        actions.addView(button("Summon Shinchan") { summon() }, weighted())
        actions.addView(button("Stop Shinchan") { stopShinchan() }, weighted())
        content.addView(actions)
        content.addView(button("Open Debug View") {
            OverlayHolder.service?.stopShinchan()
            startActivity(Intent(this, DebugActivity::class.java))
        }, matchWrap())
        content.addView(button("Open Diagnostics Simulator") {
            startActivity(Intent(this, DiagnosticsSimulatorActivity::class.java))
        }, matchWrap())

        content.addView(section("Tap injection self-test"))
        content.addView(label("Enable the Accessibility service, then tap the target below. Shinchan will tap this harmless in-app target.", 14f))
        selfTestTarget = label("SELF TEST TARGET — safe to tap", 16f, true).apply {
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(22), dp(12), dp(22))
            setBackgroundColor(0xFFE0F2FE.toInt())
            contentDescription = "Harmless Shinchan accessibility self-test target"
            setOnClickListener {
                selfTestTapReceived = true
                text = "SELF TEST TARGET — gesture received ✓"
            }
        }
        content.addView(selfTestTarget, matchWrap())
        content.addView(button("Run self-test") { runSelfTest() })

        content.addView(section("Privacy and learning"))
        val pause = CheckBox(this).apply {
            text = "Pause learning (do not send UI traces)"
            isChecked = prefs.getBoolean("pauseLearning", false)
            setOnCheckedChangeListener { _, checked -> prefs.edit().putBoolean("pauseLearning", checked).apply() }
        }
        content.addView(pause)
        content.addView(label("Excluded app package names (comma separated). Banking, payment and password manager apps are excluded by default on device.", 13f))
        val excluded = EditText(this).apply {
            hint = "com.example.privateapp"
            setText(prefs.getString("excludedApps", "com.google.android.apps.walletnfcrel,com.phonepe.app,net.one97.paytm,com.google.android.apps.nbu.paisa.user,com.sbi.SBISecure,com.axis.mobile,com.icicibank,com.x8bit.bitwarden,com.onepassword.android,com.lastpass.lpandroid,keepass2android.keepass2android,com.dashlane,com.nordpass.android.app.password.manager"))
        }
        content.addView(excluded, matchWrap())
        content.addView(button("Save exclusions") { prefs.edit().putString("excludedApps", excluded.text.toString()).apply(); statusText.text = "Excluded app list saved on this device." })
        content.addView(button("Delete all my local data (this phone)") {
            AlertDialog.Builder(this)
                .setTitle("Delete local phone data?")
                .setMessage("This clears saved Shinchan MUSE settings, excluded apps, and diagnostics from this phone.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Delete") { _, _ ->
                    stopShinchan()
                    prefs.edit().clear().apply()
                    Toast.makeText(this, "Local phone data cleared", Toast.LENGTH_LONG).show()
                    refreshChecklist()
                }
                .show()
        })
        content.addView(section("Recent diagnostics"))
        logsText = label(MuseLog.read(this).ifBlank { "No diagnostics yet." }, 12f)
        content.addView(logsText)
    }

    private fun checklistRow(parent: LinearLayout, title: String, key: String, action: () -> Unit) {
        val row = horizontal().apply { gravity = Gravity.CENTER_VERTICAL }
        val state = label("✗  $title", 15f, true)
        checklistRows[key] = state
        row.addView(state, LinearLayout.LayoutParams(0, dp(52), 1f))
        row.addView(button("Open") { action() })
        val details = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        details.addView(row, matchWrap())
        val hint = when (key) {
            "overlay" -> "Lets Shinchan float above other apps."
            "accessibility" -> "Enables approved taps and visible UI labels."
            "notifications" -> "Shows Android's foreground service notice."
            "microphone" -> "Enables optional voice input."
            "battery" -> "Helps Android keep the overlay running."
            else -> "Connects chat and learning; offline mode still works."
        }
        details.addView(label(hint, 12f).apply { setTextColor(0xFF64748B.toInt()); setPadding(dp(2), 0, 0, dp(5)) })
        parent.addView(details, matchWrap())
    }

    private fun refreshChecklist() {
        if (!::statusText.isInitialized) return
        updateRow("overlay", Settings.canDrawOverlays(this))
        updateRow("accessibility", isAccessibilityEnabled())
        updateRow("notifications", Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        updateRow("microphone", ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
        val power = getSystemService(POWER_SERVICE) as PowerManager
        updateRow("battery", Build.VERSION.SDK_INT < 23 || power.isIgnoringBatteryOptimizations(packageName))
        updateRow("server", BrainSocket.connectionStatus == "Connected" || statusText.text.toString().contains("Server OK"))
        statusText.text = "Brain: ${BrainSocket.connectionStatus}. The companion remains usable offline."
        if (::logsText.isInitialized) logsText.text = MuseLog.read(this).ifBlank { "No diagnostics yet." }
    }

    private fun updateRow(key: String, enabled: Boolean) {
        val title = when (key) { "overlay" -> "Overlay permission"; "accessibility" -> "Accessibility service"; "notifications" -> "Notifications"; "microphone" -> "Microphone"; "battery" -> "Battery optimization"; else -> "Server connection" }
        checklistRows[key]?.apply {
            text = if (enabled) "✓  $title" else "✗  $title"
            setTextColor(if (enabled) 0xFF15803D.toInt() else 0xFFB91C1C.toInt())
        }
    }

    private fun saveServerUrl(): String? {
        val raw = serverUrl.text.toString().trim()
        val uri = runCatching { Uri.parse(raw) }.getOrNull()
        if (uri == null || uri.host.isNullOrBlank() || uri.scheme !in setOf("ws", "wss", "http", "https")) {
            serverUrl.error = "Enter a ws:// or wss:// server address"
            return null
        }
        prefs.edit().putString("serverUrl", raw).apply()
        BrainSocket.reconnect(this)
        return raw
    }

    private fun testConnection() {
        val raw = saveServerUrl() ?: return
        statusText.text = "Checking /health…"
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val uri = Uri.parse(raw)
                    val scheme = if (uri.scheme == "wss" || uri.scheme == "https") "https" else "http"
                    val origin = "$scheme://${uri.host}${if (uri.port >= 0) ":${uri.port}" else ""}"
                    healthClient.newCall(Request.Builder().url("$origin/health").get().build()).execute().use { response ->
                        if (!response.isSuccessful) error("HTTP ${response.code}")
                        response.body?.string().orEmpty()
                    }
                }
            }
            result.onSuccess { statusText.text = "Server OK: $it"; updateRow("server", true); BrainSocket.reconnect(this@MainActivity) }
                .onFailure { statusText.text = "Offline: ${it.message ?: "server unreachable"}. Companion remains usable."; updateRow("server", false) }
        }
    }

    private fun summon() {
        saveServerUrl() ?: return
        if (!Settings.canDrawOverlays(this)) { openOverlaySettings(); Toast.makeText(this, "Allow display over other apps, then return and Summon again.", Toast.LENGTH_LONG).show(); return }
        startForegroundService(this, Intent(this, OverlayCompanionService::class.java))
    }

    private fun stopShinchan() {
        OverlayHolder.service?.stopShinchan()
        stopService(Intent(this, OverlayCompanionService::class.java))
    }

    private fun runSelfTest() {
        if (!isAccessibilityEnabled()) { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); Toast.makeText(this, "Enable Shinchan MUSE Accessibility, then run the self-test again.", Toast.LENGTH_LONG).show(); return }
        val service = MuseAccessibilityService.instance
        if (service == null) { statusText.text = "Accessibility service is not connected yet. Return here and retry."; return }
        selfTestTapReceived = false
        selfTestTarget.text = "SELF TEST TARGET — waiting for Shinchan's tap…"
        service.tapView(selfTestTarget) { completed -> runOnUiThread {
            val success = completed && selfTestTapReceived
            statusText.text = if (success) "Self-test passed: the in-app target received the gesture." else "Self-test failed or was interrupted. Check Accessibility settings and diagnostics."
            if (!selfTestTapReceived) selfTestTarget.text = "SELF TEST TARGET — safe to tap"
        } }
    }

    private fun isAccessibilityEnabled(): Boolean {
        val component = ComponentName(this, MuseAccessibilityService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        return enabled.split(':').any { it.equals(component, true) }
    }

    private fun requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33) permissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
        else Toast.makeText(this, "Notifications are controlled by Android app notification settings.", Toast.LENGTH_SHORT).show()
    }

    private fun openOverlaySettings() {
        if (Build.VERSION.SDK_INT >= 23) startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
    }

    private fun openBatterySettings() {
        if (Build.VERSION.SDK_INT >= 23) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
            runCatching { startActivity(intent) }.onFailure { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
    }

    private fun openAppInfo() { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }

    private fun section(text: String) = label(text, 20f, true).apply { setPadding(0, dp(22), 0, dp(8)) }
    private fun label(text: String, size: Float, bold: Boolean = false) = TextView(this).apply {
        this.text = text; textSize = size; setTextColor(0xFF172033.toInt()); setPadding(0, dp(5), 0, dp(5))
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    private fun button(text: String, action: () -> Unit) = Button(this).apply { this.text = text; setOnClickListener { action() } }
    private fun horizontal() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    private fun card() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(12), dp(14), dp(12)); setBackgroundColor(0xFFF1F5F9.toInt()) }
    private fun matchWrap() = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    private fun weighted() = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() { refreshJob?.cancel(); scope.cancel(); healthClient.dispatcher.executorService.shutdown(); healthClient.connectionPool.evictAll(); super.onDestroy() }

    companion object { const val ACTION_VOICE_PROMPT = "com.muse.shinchan.VOICE_PROMPT" }
}
