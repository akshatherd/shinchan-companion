package com.muse.shinchan

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.app.PendingIntent
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.view.MotionEvent
import android.view.GestureDetector
import android.view.View
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.WindowManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.Locale
import java.util.ArrayDeque

class OverlayCompanionService : LifecycleService() {
    private lateinit var windowManager: WindowManager
    private lateinit var web: WebView
    private lateinit var params: WindowManager.LayoutParams
    private lateinit var touchProxy: View
    private lateinit var touchParams: WindowManager.LayoutParams
    @Volatile private var interactive = true
    @Volatile private var expanded = false
    @Volatile private var privacySuppressed = false
    @Volatile private var viewAttached = false
    @Volatile private var bounds = Rect(0, 0, 0, 0)
    private var startFailed = false
    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    @Volatile private var followUpListening = false
    private var followUpTimeout: Runnable? = null
    private var pendingUtterance: String? = null
    private var idleHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var lastActivityAt = System.currentTimeMillis()
    private var lastForegroundPackage = ""
    @Volatile private var pageReady = false
    private val pendingPageMessages = ArrayDeque<JSONObject>()
    private var dragLastX = 0f
    private var dragLastY = 0f
    private var dragActive = false
    @Volatile private var nativeTouchSeen = false
    @Volatile private var pageTapSeen = false
    @Volatile private var bridgeJsSeen = false
    @Volatile private var eventBridgeSeen = false
    @Volatile private var ttsReady = false
    @Volatile private var pendingActionPlan: JSONObject? = null
    @Volatile private var actionInProgress = false
    private val llmClient = OkHttpClient.Builder().callTimeout(18, java.util.concurrent.TimeUnit.SECONDS).build()
    private val autonomyTick = object : Runnable { override fun run() {
        val idleSeconds = (System.currentTimeMillis() - lastActivityAt) / 1000
        dispatchAutonomyEvent(JSONObject().put("type", "USER_IDLE").put("seconds", idleSeconds))
        dispatchAutonomyEvent(JSONObject().put("type", "TIME_TICK").put("hour", java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)))
        idleHandler.postDelayed(this, 5_000)
    } }
    private val systemEvents = object : BroadcastReceiver() { override fun onReceive(context: android.content.Context?, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_USER_PRESENT -> { lastActivityAt = System.currentTimeMillis(); dispatchAutonomyEvent(JSONObject().put("type", "USER_PRESENT")) }
            Intent.ACTION_SCREEN_ON -> dispatchAutonomyEvent(JSONObject().put("type", "SCREEN_ON"))
            Intent.ACTION_SCREEN_OFF -> dispatchAutonomyEvent(JSONObject().put("type", "SCREEN_OFF"))
            Intent.ACTION_POWER_CONNECTED, Intent.ACTION_POWER_DISCONNECTED -> dispatchAutonomyEvent(JSONObject().put("type", "CHARGING").put("charging", intent.action == Intent.ACTION_POWER_CONNECTED))
            Intent.ACTION_BATTERY_LOW -> dispatchAutonomyEvent(JSONObject().put("type", "BATTERY_LOW"))
            Intent.ACTION_HEADSET_PLUG -> dispatchAutonomyEvent(JSONObject().put("type", "HEADSET").put("connected", intent.getIntExtra("state", 0) == 1))
        }
    } }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, notification())
        if (!android.provider.Settings.canDrawOverlays(this)) {
            startFailed = true
            MuseLog.write(this, "Overlay permission missing; returning to onboarding")
            runCatching { startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
                .onFailure { MuseLog.write(this, "Could not return to onboarding: ${it.message}", it) }
            stopSelf()
            return
        }
        try {
            windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
            createWebView()
            createWindowParams()
            windowManager.addView(web, params)
            viewAttached = true
            createTouchProxy()
            OverlayHolder.service = this
            MuseLog.write(this, "Overlay started using WebViewAssetLoader")
            BrainSocket.connect(this)
            MuseAccessibilityService.instance?.attach(this)
            audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
            textToSpeech = TextToSpeech(this) { result ->
                ttsReady = result == TextToSpeech.SUCCESS && textToSpeech?.voices?.isNotEmpty() == true
                if (ttsReady) textToSpeech?.language = Locale.US
                MuseLog.writeTagged(this, "SHN_TTS", if (ttsReady) "TTS initialized with ${textToSpeech?.voice?.name}" else "TTS initialization failed or no voice installed")
                textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) { postToPage(JSONObject().put("type", "VOICE_PROGRESS").put("event", "onTtsStart")); MuseLog.writeTagged(this@OverlayCompanionService, "SHN_TTS", "speech started") }
                    override fun onDone(utteranceId: String?) {
                        postToPage(JSONObject().put("type", "VOICE_PROGRESS").put("event", "onTtsDone")); abandonSpeechFocus()
                        MuseLog.writeTagged(this@OverlayCompanionService, "SHN_TTS", "speech completed")
                        if (followUpListening) {
                            followUpListening = false
                            followUpTimeout = Runnable { speechRecognizer?.cancel(); speechRecognizer?.destroy(); speechRecognizer = null; dispatchAutonomyEvent(JSONObject().put("type", "LISTENING_END")) }
                            startVoiceInput(isFollowUp = true)
                            idleHandler.postDelayed(followUpTimeout!!, 6_000)
                        }
                    }
                    override fun onError(utteranceId: String?) { postToPage(JSONObject().put("type", "VOICE_PROGRESS").put("event", "onTtsError")); abandonSpeechFocus(); MuseLog.writeTagged(this@OverlayCompanionService, "SHN_TTS", "speech playback failed") }
                })
            }
            idleHandler.postDelayed(autonomyTick, 5_000)
            val eventFilter = IntentFilter().apply { addAction(Intent.ACTION_USER_PRESENT); addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_POWER_CONNECTED); addAction(Intent.ACTION_POWER_DISCONNECTED); addAction(Intent.ACTION_BATTERY_LOW); addAction(Intent.ACTION_HEADSET_PLUG) }
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(systemEvents, eventFilter, Context.RECEIVER_NOT_EXPORTED) else @Suppress("DEPRECATION") registerReceiver(systemEvents, eventFilter)
            dispatchAutonomyEvent(JSONObject().put("type", "HOUR_OF_DAY").put("hour", java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)))
        } catch (error: Exception) {
            startFailed = true
            MuseLog.write(this, "Unable to attach floating window: ${error.message}", error)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        return if (startFailed) START_NOT_STICKY else START_STICKY
    }

    private fun createWebView() {
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            setLayerType(WebView.LAYER_TYPE_HARDWARE, null)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            addJavascriptInterface(AndroidWebBridge(this@OverlayCompanionService), "AndroidBridge")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest) = assetLoader.shouldInterceptRequest(request.url)
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
            MuseLog.writeTagged(this@OverlayCompanionService, "SHN_BRIDGE", "loading page ${url?.substringBefore('?')}")
                }
                override fun onPageFinished(view: WebView?, url: String?) {
            MuseLog.writeTagged(this@OverlayCompanionService, "SHN_BRIDGE", "overlay document loaded; waiting for model readiness")
                    dispatchConnectionStatus(BrainSocket.connectionStatus)
                }
                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    if (request?.isForMainFrame == true) {
                        val detail = error?.description?.toString() ?: "Unable to load overlay page"
                        MuseLog.write(this@OverlayCompanionService, "WebView page error: $detail", IllegalStateException(detail))
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    MuseLog.write(this@OverlayCompanionService, "Web ${message.messageLevel()}: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                    return true
                }
                override fun onPermissionRequest(request: PermissionRequest) {
                    val audioAllowed = ContextCompat.checkSelfPermission(this@OverlayCompanionService, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    if (audioAllowed && request.resources.all { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }) request.grant(request.resources)
                    else request.deny()
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/overlay/index.html?mode=overlay")
        }
    }

    private fun createWindowParams() {
        val density = resources.displayMetrics.density
        val widthDp = getSharedPreferences("muse", MODE_PRIVATE).getInt("overlayWidthDp", DEFAULT_WIDTH_DP).coerceIn(120, 300)
        val heightDp = getSharedPreferences("muse", MODE_PRIVATE).getInt("overlayHeightDp", DEFAULT_HEIGHT_DP).coerceIn(160, 400)
        val width = (widthDp * density).toInt()
        val height = (heightDp * density).toInt()
        params = WindowManager.LayoutParams(
            width,
            height,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            // Android 12+ only permits pass-through touches through sufficiently translucent SAW windows.
            alpha = 0.79f
            x = (resources.displayMetrics.widthPixels - width - 24 * density).toInt().coerceAtLeast(0)
            y = (resources.displayMetrics.heightPixels - height - 56 * density).toInt().coerceAtLeast(0)
        }
    }

    private fun createTouchProxy() {
        // Keep the whole compact window touchable until the first valid model bounds arrive.
        bounds = Rect(0, 0, params.width, params.height)
        val gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(event: MotionEvent): Boolean { dragLastX = event.rawX; dragLastY = event.rawY; dragActive = false; return true }
            override fun onSingleTapConfirmed(event: MotionEvent): Boolean { onNativeTap(event.rawX, event.rawY); return true }
            override fun onDoubleTap(event: MotionEvent): Boolean { onNativeDoubleTap(); return true }
            override fun onLongPress(event: MotionEvent) { onNativeLongPress() }
        })
        touchProxy = View(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
            setOnTouchListener { _, event ->
                dispatchProxyTouch(event)
                gestureDetector.onTouchEvent(event)
                when (event.actionMasked) {
                    MotionEvent.ACTION_MOVE -> {
                        if (kotlin.math.hypot(event.rawX - dragLastX, event.rawY - dragLastY) > 8f) dragActive = true
                        if (dragActive) {
                            moveOverlayWindow((event.rawX - dragLastX).toInt(), (event.rawY - dragLastY).toInt())
                            dragLastX = event.rawX; dragLastY = event.rawY
                        }
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        if (dragActive) {
                            MuseLog.writeTagged(this@OverlayCompanionService, "SHN_TOUCH", "drag moved overlay to ${params.x},${params.y}")
                            postGestureToPage("onDrag", JSONObject().put("x", params.x).put("y", params.y))
                        }
                    }
                }
                true
            }
        }
        touchParams = WindowManager.LayoutParams(
            1, 1, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START; alpha = 0.01f; x = params.x; y = params.y }
        params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        runCatching { windowManager.updateViewLayout(web, params) }
        windowManager.addView(touchProxy, touchParams)
        updateTouchProxy()
    }

    private fun dispatchProxyTouch(event: MotionEvent) {
        if (!::web.isInitialized || !interactive) return
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            nativeTouchSeen = true
            MuseLog.writeTagged(this, "SHN_TOUCH", "native DOWN raw=(${event.rawX.toInt()},${event.rawY.toInt()}) window=(${params.x},${params.y})")
        }
        val forwarded = MotionEvent.obtain(event)
        val targetX = event.rawX - params.x
        val targetY = event.rawY - params.y
        forwarded.offsetLocation(targetX - event.x, targetY - event.y)
        web.dispatchTouchEvent(forwarded)
        forwarded.recycle()
    }

    private fun moveOverlayWindow(dx: Int, dy: Int) {
        if (!::params.isInitialized || !viewAttached || expanded) return
        params.x = (params.x + dx).coerceIn(0, (resources.displayMetrics.widthPixels - params.width).coerceAtLeast(0))
        params.y = (params.y + dy).coerceIn(0, (resources.displayMetrics.heightPixels - params.height).coerceAtLeast(0))
        runCatching { windowManager.updateViewLayout(web, params); updateTouchProxy() }
            .onFailure { MuseLog.writeTagged(this, "SHN_TOUCH", "drag update failed: ${it.message}", it) }
    }

    private fun onNativeTap(rawX: Float, rawY: Float) {
        nativeTouchSeen = true
        MuseLog.writeTagged(this, "SHN_TOUCH", "native tap at (${rawX.toInt()},${rawY.toInt()}); forwarded to overlay page")
        postGestureToPage("onTap", JSONObject().put("x", rawX).put("y", rawY))
        startVoiceInput()
    }

    private fun onNativeDoubleTap() {
        MuseLog.writeTagged(this, "SHN_TOUCH", "native double tap; dance reaction")
        postGestureToPage("onDoubleTap", JSONObject())
        dispatchAutonomyEvent(JSONObject().put("type", "DANCE_SILLY"))
    }

    private fun onNativeLongPress() {
        MuseLog.writeTagged(this, "SHN_TOUCH", "native long press; opening quick menu")
        postGestureToPage("onLongPress", JSONObject())
        runCatching { startActivity(Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_OVERLAY_MENU).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
            .onFailure { MuseLog.writeTagged(this, "SHN_TOUCH", "quick menu unavailable: ${it.message}", it) }
    }

    private fun postGestureToPage(method: String, payload: JSONObject) {
        postToPage(JSONObject().put("type", "NATIVE_GESTURE").put("method", method).put("payload", payload))
    }

    private fun updateTouchProxy() {
        if (!::touchParams.isInitialized || !viewAttached) return
        val left = bounds.left.coerceIn(0, web.width.coerceAtLeast(params.width))
        val top = bounds.top.coerceIn(0, web.height.coerceAtLeast(params.height))
        val right = bounds.right.coerceIn(left, web.width.coerceAtLeast(params.width))
        val bottom = bounds.bottom.coerceIn(top, web.height.coerceAtLeast(params.height))
        val enabled = interactive && right > left && bottom > top && !expanded
        touchParams.width = if (enabled) (right - left).coerceAtLeast(1) else 1
        touchParams.height = if (enabled) (bottom - top).coerceAtLeast(1) else 1
        touchParams.x = if (enabled) params.x + left else params.x
        touchParams.y = if (enabled) params.y + top else params.y
        touchParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            (if (enabled) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
        touchProxy.visibility = View.VISIBLE
        runCatching { windowManager.updateViewLayout(touchProxy, touchParams) }
            .onFailure { MuseLog.write(this, "Touch proxy update failed: ${it.message}", it) }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL_ID, "Shinchan companion", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Persistent status while the floating companion is running"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun notification(): Notification {
        val stopIntent = PendingIntent.getService(
            this, 42, Intent(this, StopRoutineService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        )
        val openIntent = PendingIntent.getActivity(this, 43, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0))
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Shinchan MUSE is active")
            .setContentText("Tap Stop Shinchan to close the floating companion")
            .setContentIntent(openIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop Shinchan", stopIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    fun setInteractive(value: Boolean) { interactive = value; updateTouchProxy() }

    fun setInteractiveBounds(left: Float, top: Float, width: Float, height: Float) {
        if (!left.isFinite() || !top.isFinite() || !width.isFinite() || !height.isFinite() || width < 4f || height < 4f) return
        val density = resources.displayMetrics.density
        bounds = Rect((left * density).toInt(), (top * density).toInt(), ((left + width) * density).toInt(), ((top + height) * density).toInt())
        web.post { updateTouchProxy() }
    }

    fun resizeWindow(widthDp: Int, heightDp: Int) {
        val prefs = getSharedPreferences("muse", MODE_PRIVATE)
        val targetWidthDp = if (widthDp <= 0) prefs.getInt("overlayWidthDp", DEFAULT_WIDTH_DP) else widthDp.coerceIn(120, 360)
        val targetHeightDp = if (heightDp <= 0) prefs.getInt("overlayHeightDp", DEFAULT_HEIGHT_DP) else heightDp.coerceIn(160, 480)
        setWindowSize(targetWidthDp, targetHeightDp, false, true)
    }

    private fun setWindowSize(widthDp: Int, heightDp: Int, fullScreen: Boolean, touchable: Boolean) {
        val wasExpanded = expanded
        expanded = fullScreen
        interactive = touchable
        if (!::params.isInitialized || !viewAttached) return
        web.post {
            val density = resources.displayMetrics.density
            val screenW = resources.displayMetrics.widthPixels
            val screenH = resources.displayMetrics.heightPixels
            val oldW = params.width; val oldH = params.height
            val newW = if (fullScreen) screenW else (widthDp * density).toInt().coerceAtMost(screenW)
            val newH = if (fullScreen) screenH else (heightDp * density).toInt().coerceAtMost(screenH)
            val sideMargin = (24 * density).toInt().coerceAtMost(((screenW - newW).coerceAtLeast(0)) / 2)
            val topMargin = (24 * density).toInt().coerceAtMost(((screenH - newH).coerceAtLeast(0)) / 2)
            val bottomMargin = (56 * density).toInt().coerceAtMost(((screenH - newH).coerceAtLeast(0)) / 2)
            val positionFits = fullScreen || (params.x in sideMargin..(screenW - newW - sideMargin).coerceAtLeast(sideMargin) &&
                params.y in topMargin..(screenH - newH - bottomMargin).coerceAtLeast(topMargin))
            if (wasExpanded == fullScreen && params.width == newW && params.height == newH && positionFits) {
                updateTouchProxy()
                return@post
            }
            val oldCenterX = params.x + if (bounds.isEmpty) oldW / 2 else bounds.centerX()
            val oldCenterY = params.y + if (bounds.isEmpty) oldH / 2 else bounds.centerY()
            params.width = newW; params.height = newH
            params.x = if (fullScreen) 0 else (oldCenterX - newW / 2).coerceIn(sideMargin, (screenW - newW - sideMargin).coerceAtLeast(sideMargin))
            params.y = if (fullScreen) 0 else (oldCenterY - newH / 2).coerceIn(topMargin, (screenH - newH - bottomMargin).coerceAtLeast(topMargin))
            params.flags = params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            runCatching { windowManager.updateViewLayout(web, params) }.onFailure { MuseLog.write(this, "Window resize failed: ${it.message}", it) }
            updateTouchProxy()
        }
    }

    fun setWindowMode(fullScreen: Boolean, touchable: Boolean) {
        val prefs = getSharedPreferences("muse", MODE_PRIVATE)
        setWindowSize(prefs.getInt("overlayWidthDp", DEFAULT_WIDTH_DP), prefs.getInt("overlayHeightDp", DEFAULT_HEIGHT_DP), fullScreen, touchable)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        setWindowMode(expanded, interactive)
    }

    fun onState(state: String) {
        when (state) {
            "WALK_TO_TARGET", "POKE" -> { setWindowMode(true, false); MuseAccessibilityService.instance?.setRoutineActive(true) }
            "RETURN_HOME" -> { setWindowMode(true, false); MuseAccessibilityService.instance?.setRoutineActive(false) }
            "ASK_PERMISSION" -> { resizeWindow(320, 360); MuseAccessibilityService.instance?.setRoutineActive(false) }
            else -> { setWindowMode(false, true); MuseAccessibilityService.instance?.setRoutineActive(false) }
        }
    }

    fun dispatchAutonomyEvent(event: JSONObject) {
        val payload = JSONObject(event.toString())
        val kind = payload.optString("type")
        payload.put("kind", kind).put("type", "AUTONOMY_EVENT")
        MuseLog.writeTagged(this, "SHN_EVENT", "emit $kind")
        postToPage(payload)
    }

    fun markPageReady() {
        pageReady = true
        val queued = synchronized(pendingPageMessages) { pendingPageMessages.toList().also { pendingPageMessages.clear() } }
        MuseLog.writeTagged(this, "SHN_BRIDGE", "page ready; flushing ${queued.size} queued messages")
        queued.forEach(::postToPage)
    }

    fun postToPage(message: JSONObject) {
        if (!::web.isInitialized) return
        if (!pageReady && message.optString("type") != "CONNECTION_STATUS") {
            synchronized(pendingPageMessages) {
                if (pendingPageMessages.size >= 100) pendingPageMessages.removeFirst()
                pendingPageMessages.addLast(JSONObject(message.toString()))
            }
            MuseLog.writeTagged(this, "SHN_BRIDGE", "queued ${message.optString("type")}")
            return
        }
        val encoded = JSONObject.quote(message.toString())
        web.post {
            val script = if (message.optString("type") == "NATIVE_GESTURE") {
                val method = JSONObject.quote(message.optString("method"))
                "window.ShinchanAPI&&window.ShinchanAPI[$method]&&window.ShinchanAPI[$method](JSON.parse($encoded))"
            } else "window.postMessage(JSON.parse($encoded),'*')"
            web.evaluateJavascript(script, null)
        }
        if (message.optString("type") == "AUTONOMY_EVENT") eventBridgeSeen = true
        MuseLog.writeTagged(this, "SHN_BRIDGE", "Android->JS ${message.optString("type")} delivered")
    }

    fun markPageTap(x: Float, y: Float) { pageTapSeen = true; MuseLog.writeTagged(this, "SHN_TOUCH", "page tap acknowledged at (${x.toInt()},${y.toInt()})") }
    fun markBridgeJsSeen() { bridgeJsSeen = true }
    fun healthSnapshot(): List<Pair<Boolean, String>> = listOf(
        (viewAttached && ::params.isInitialized && ::touchParams.isInitialized) to if (viewAttached && ::params.isInitialized) "overlay window attached; touch proxy ${bounds.width()}×${bounds.height()} px" else "overlay window is not attached",
        nativeTouchSeen to if (nativeTouchSeen) "native touch detected" else "tap Shinchan once to verify native touch",
        pageTapSeen to if (pageTapSeen) "tap reached the JavaScript page" else "page has not acknowledged a tap yet",
        bridgeJsSeen to if (bridgeJsSeen) "JavaScript called Android bridge" else "bridge ping has not run",
        (pageReady && eventBridgeSeen) to if (pageReady && eventBridgeSeen) "Android event delivered after page readiness" else "event bridge awaits a simulated event",
        (BrainSocket.connectionStatus == "Connected") to "WebSocket ${BrainSocket.connectionStatus}",
        true to "run the server and LLM probe below for live status",
        (SpeechRecognizer.isRecognitionAvailable(this) && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) to if (SpeechRecognizer.isRecognitionAvailable(this) && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) "speech engine and microphone permission ready" else "enable microphone permission and install a speech engine",
        (ttsReady && textToSpeech?.voices?.isNotEmpty() == true) to if (ttsReady && textToSpeech?.voices?.isNotEmpty() == true) "TTS initialized with ${textToSpeech?.voice?.name ?: "a voice"}" else "TTS engine is not initialized or has no voice",
        (MuseAccessibilityService.instance != null) to if (MuseAccessibilityService.instance != null) "Accessibility service connected" else "enable Shinchan MUSE in Accessibility settings",
        false to "run the in-app accessibility self-test below",
        true to "Calculator launch can be checked with the demo button"
    )

    fun setPrivacySuppressed(hidden: Boolean) {
        if (!::web.isInitialized) return
        web.post {
            if (privacySuppressed == hidden) return@post
            privacySuppressed = hidden
            web.visibility = if (hidden) View.INVISIBLE else View.VISIBLE
            interactive = !hidden
            updateTouchProxy()
            dispatchAutonomyEvent(JSONObject().put("type", "PRIVACY_SUPPRESS").put("hidden", hidden))
        }
    }

    fun startVoiceInput() {
        lastActivityAt = System.currentTimeMillis()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || !SpeechRecognizer.isRecognitionAvailable(this)) {
            openVoiceTextPrompt(); return
        }
        try {
            speechRecognizer?.destroy()
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: android.os.Bundle?) { dispatchAutonomyEvent(JSONObject().put("type", "LISTENING")) }
                    override fun onResults(results: android.os.Bundle?) {
                        val spoken = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                        if (spoken.isBlank()) speakReply(localReply("")) else handleUtterance(spoken)
                        speechRecognizer?.destroy(); speechRecognizer = null
                    }
                    override fun onError(error: Int) { MuseLog.write(this@OverlayCompanionService, "Speech recognition unavailable ($error)"); speechRecognizer?.destroy(); speechRecognizer = null; openVoiceTextPrompt() }
                    override fun onBeginningOfSpeech() { }
                    override fun onRmsChanged(rmsdB: Float) { }
                    override fun onBufferReceived(buffer: ByteArray?) { }
                    override fun onEndOfSpeech() { }
                    override fun onPartialResults(partialResults: android.os.Bundle?) { }
                    override fun onEvent(eventType: Int, params: android.os.Bundle?) { }
                })
                startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply { putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM); putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN"); putExtra(RecognizerIntent.EXTRA_PROMPT, "Talk to Shinchan") })
            }
            dispatchAutonomyEvent(JSONObject().put("type", "LISTENING"))
        } catch (error: Exception) { MuseLog.write(this, "Could not start speech recognition: ${error.message}", error); openVoiceTextPrompt() }
    }

    fun handleUtterance(text: String) {
        lastActivityAt = System.currentTimeMillis()
        pendingUtterance = text
        if (BrainSocket.connectionStatus == "Connected") {
            sendJson(JSONObject().put("type", "CHAT").put("text", text).put("userId", "local"))
            web.postDelayed({ if (pendingUtterance == text) { pendingUtterance = null; requestStandaloneReply(text) } }, 6500)
        } else requestStandaloneReply(text)
    }

    private fun openVoiceTextPrompt() {
        runCatching { startActivity(Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_VOICE_PROMPT).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
            .onFailure { speakReply("Arre, mic is busy. Open Shinchan MUSE and type what you want to say!") }
    }

    fun submitVoiceText(text: String) { if (text.isNotBlank()) handleUtterance(text.trim()) }

    private fun localReply(raw: String): String {
        val text = raw.lowercase(Locale.ROOT)
        return when {
            text.isBlank() -> "Arre, kuch bolo na! I'm listening."
            listOf("hello", "hi", "hey", "namaste").any(text::contains) -> "Hii! Shinchan is here. Aaj kya masti karein?"
            listOf("dance", "music", "song").any(text::contains) -> "Music on karo! Main apna silly dance dikhata hoon."
            listOf("help", "remind", "remember").any(text::contains) -> "Haan, bolo! Main dhyaan se sun raha hoon."
            listOf("sleep", "tired", "good night").any(text::contains) -> "Oho, sleepy time! Good night, sweet dreams."
            else -> "Wah, interesting! ${raw.take(60)} — ab batao, next kya plan hai?"
        }
    }

    private fun requestStandaloneReply(userText: String) {
        val prefs = getSharedPreferences("muse", MODE_PRIVATE)
        val apiKey = prefs.getString("llmApiKey", "").orEmpty().trim()
        if (apiKey.isBlank()) { speakReply(localReply(userText)); return }
        val provider = prefs.getString("llmProvider", "Gemini") ?: "Gemini"
        val mediaType = "application/json; charset=utf-8".toMediaType()
        val request = if (provider == "OpenAI") {
            val messages = org.json.JSONArray()
                .put(JSONObject().put("role", "system").put("content", "You are Shinchan, a playful, kind cartoon friend. Reply in concise Hinglish or English, under 35 words."))
                .put(JSONObject().put("role", "user").put("content", userText))
            val body = JSONObject().put("model", "gpt-4o-mini").put("messages", messages).toString()
            Request.Builder().url("https://api.openai.com/v1/chat/completions").header("Authorization", "Bearer $apiKey").post(body.toRequestBody(mediaType)).build()
        } else {
            val instruction = JSONObject().put("parts", org.json.JSONArray().put(JSONObject().put("text", "You are Shinchan, a playful, kind cartoon friend. Reply in concise Hinglish or English, under 35 words.")))
            val contents = org.json.JSONArray().put(JSONObject().put("parts", org.json.JSONArray().put(JSONObject().put("text", userText))))
            val body = JSONObject().put("system_instruction", instruction).put("contents", contents).toString()
            val encodedKey = java.net.URLEncoder.encode(apiKey, "UTF-8")
            Request.Builder().url("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$encodedKey").post(body.toRequestBody(mediaType)).build()
        }
        llmClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) { MuseLog.write(this@OverlayCompanionService, "Standalone AI request failed: ${error.message}"); speakReply(localReply(userText)) }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val parsed = if (it.isSuccessful) runCatching {
                        val json = JSONObject(it.body?.string().orEmpty())
                        if (provider == "OpenAI") json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
                        else json.getJSONArray("candidates").getJSONObject(0).getJSONObject("content").getJSONArray("parts").getJSONObject(0).getString("text")
                    }.getOrNull() else null
                    if (parsed.isNullOrBlank()) { MuseLog.write(this@OverlayCompanionService, "Standalone AI returned HTTP ${it.code}"); speakReply(localReply(userText)) }
                    else speakReply(parsed.trim().take(220))
                }
            }
        })
    }

    private fun speakReply(text: String) {
        pendingUtterance = null
        val dispatch = Runnable {
            postToPage(JSONObject().put("type", "VOICE_REPLY").put("text", text.take(110)))
            textToSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "shinchan-reply")
        }
        if (::web.isInitialized) web.post(dispatch) else idleHandler.post(dispatch)
    }

    fun mapOverlayPoint(x: Float, y: Float): Pair<Float, Float> {
        val density = resources.displayMetrics.density
        return Pair(params.x + x * density, params.y + y * density)
    }

    fun sendJson(json: JSONObject) {
        if (getSharedPreferences("muse", MODE_PRIVATE).getBoolean("pauseLearning", false) && json.optString("type") == "TRACE") return
        BrainSocket.send(this, json)
    }

    fun dispatchServerMessage(message: String) {
        if (!::web.isInitialized) return
        val data = runCatching { JSONObject(message) }.getOrNull() ?: run { MuseLog.write(this, "Ignored invalid server JSON"); return }
        val type = data.optString("type")
        if (type == "CHAT_REPLY") {
            if (pendingUtterance != null) speakReply(data.optString("text", "Arre, server se reply nahi aaya!"))
            return
        }
        val state = data.optString("state", data.optString("name"))
        val hasTarget = type == "WALK_TO_TARGET" || type == "WALK_AND_POKE" || (type == "STATE" || type == "REQUEST_STATE") && state in setOf("WALK_TO_TARGET", "WALK_AND_POKE")
        if (hasTarget && data.has("x") && data.has("y")) {
            val density = resources.displayMetrics.density
            data.put("x", data.optDouble("x") / density)
            data.put("y", data.optDouble("y") / density)
        }
        MuseLog.writeTagged(this, "SHN_WS", "server message ${data.optString("type")}")
        postToPage(data)
    }

    fun dispatchConnectionStatus(status: String) {
        if (!::web.isInitialized) return
        postToPage(JSONObject().put("type", "CONNECTION_STATUS").put("status", status).put("connected", status == "Connected"))
    }

    fun onPermissionApproved(actionId: String) {
        postToPage(JSONObject().put("type", "REQUEST_STATE").put("state", "RETURN_HOME").put("params", JSONObject().put("actionId", actionId)))
    }

    fun stopRoutine() {
        postToPage(JSONObject().put("type", "REQUEST_STATE").put("state", "RETURN_HOME").put("params", JSONObject().put("force", true)))
        MuseAccessibilityService.instance?.setRoutineActive(false)
        sendJson(JSONObject().put("type", "CORRECTION").put("reward", -1.0))
    }

    fun onTapResult(completed: Boolean) {
        MuseLog.write(this, if (completed) "Approved gesture completed" else "Approved gesture failed or Accessibility is unavailable")
        sendJson(JSONObject().put("type", "TAP_RESULT").put("success", completed).put("reward", if (completed) 1.0 else -1.0))
    }

    fun stopShinchan() { stopRoutine(); stopSelf() }

    override fun onDestroy() {
        MuseLog.write(this, "Overlay service stopped")
        OverlayHolder.service = null
        BrainSocket.close()
        idleHandler.removeCallbacksAndMessages(null)
        runCatching { unregisterReceiver(systemEvents) }
        speechRecognizer?.destroy(); speechRecognizer = null
        textToSpeech?.stop(); textToSpeech?.shutdown(); textToSpeech = null
        if (viewAttached) runCatching { windowManager.removeView(web) }
        if (::touchProxy.isInitialized) runCatching { windowManager.removeView(touchProxy) }
        viewAttached = false
        if (::web.isInitialized) {
            web.stopLoading(); web.removeJavascriptInterface("AndroidBridge"); web.webChromeClient = null; web.webViewClient = WebViewClient(); web.destroy()
        }
        super.onDestroy()
    }

    fun recordPageTap(x: Float, y: Float) { pageTapSeen = true; MuseLog.writeTagged(this, "SHN_TOUCH", "page tap acknowledged at (${x.toInt()},${y.toInt()})") }
    fun recordJsBridge() { bridgeJsSeen = true }

    override fun onBind(intent: Intent): IBinder? = super.onBind(intent)

    companion object {
        private const val CHANNEL_ID = "muse_overlay"
        private const val NOTIFICATION_ID = 41
        const val ACTION_STOP = "com.muse.shinchan.STOP"
        const val DEFAULT_WIDTH_DP = 180
        const val DEFAULT_HEIGHT_DP = 240
    }
}
