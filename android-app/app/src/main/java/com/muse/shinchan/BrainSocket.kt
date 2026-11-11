package com.muse.shinchan

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.min

object BrainSocket {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var socket: WebSocket? = null
    @Volatile private var owner: OverlayCompanionService? = null
    @Volatile private var applicationContext: Context? = null
    @Volatile private var retryCount = 0
    @Volatile private var closedByUser = false
    @Volatile var connectionStatus: String = "Offline"
        private set

    @Synchronized fun connect(context: Context) {
        applicationContext = context.applicationContext
        if (context is OverlayCompanionService) owner = context
        if (socket != null) return
        closedByUser = false
        val raw = context.getSharedPreferences("muse", Context.MODE_PRIVATE)
            .getString("serverUrl", "ws://10.0.2.2:8000/ws/companion") ?: return
        val uri = Uri.parse(raw.trim())
        val scheme = when (uri.scheme?.lowercase()) { "http" -> "ws"; "https" -> "wss"; "ws", "wss" -> uri.scheme!!.lowercase(); else -> "" }
        if (scheme.isEmpty() || uri.host.isNullOrBlank()) {
            updateStatus("Invalid server URL")
            MuseLog.write(context, "Invalid WebSocket URL: $raw")
            return
        }
        val path = uri.path.orEmpty().trimEnd('/').ifEmpty { "/ws/companion" }
        val endpoint = Uri.Builder().scheme(scheme).encodedAuthority(uri.encodedAuthority).path(if (path.endsWith("/ws/companion")) path else "$path/ws/companion").build().toString()
        updateStatus("Connecting")
        val displayPort = uri.port.takeIf { it >= 0 } ?: if (scheme == "wss") 443 else 80
        MuseLog.write(context, "Connecting to brain server at ${uri.host}:$displayPort")
        socket = client.newWebSocket(Request.Builder().url(endpoint).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                synchronized(this@BrainSocket) { retryCount = 0 }
                updateStatus("Connected")
                owner?.dispatchServerMessage("{\"type\":\"CONNECTION_STATUS\",\"connected\":true}")
                owner?.let { MuseLog.write(it, "Brain server connected") }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                owner?.dispatchServerMessage(text)
                owner?.let { MuseLog.write(it, "Server message received (${text.length} chars)") }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                synchronized(this@BrainSocket) { if (socket === webSocket) socket = null }
                val contextForRetry = owner ?: applicationContext
                updateStatus("Offline")
                owner?.dispatchServerMessage("{\"type\":\"CONNECTION_STATUS\",\"connected\":false}")
                contextForRetry?.let { MuseLog.write(it, "Brain server unreachable: ${t.message ?: "connection failed"}") }
                if (!closedByUser && contextForRetry != null) scheduleReconnect(contextForRetry)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                synchronized(this@BrainSocket) { if (socket === webSocket) socket = null }
                updateStatus("Offline")
                owner?.dispatchServerMessage("{\"type\":\"CONNECTION_STATUS\",\"connected\":false}")
                if (!closedByUser) (owner ?: applicationContext)?.let { scheduleReconnect(it) }
            }
        })
    }

    @Synchronized fun reconnect(context: Context) {
        closedByUser = true
        handler.removeCallbacksAndMessages(null)
        socket?.cancel()
        socket = null
        closedByUser = false
        retryCount = 0
        connect(context)
    }

    @Synchronized private fun scheduleReconnect(context: Context) {
        if (closedByUser || socket != null) return
        retryCount = min(retryCount + 1, 6)
        val delayMs = min(30_000L, 1_000L shl (retryCount - 1))
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ synchronized(this@BrainSocket) { if (socket == null && !closedByUser) connect(context) } }, delayMs)
        updateStatus("Reconnecting in ${delayMs / 1000}s")
    }

    fun send(context: Context, json: JSONObject) {
        if (socket == null) connect(context)
        if (socket?.send(json.toString()) != true) MuseLog.write(context, "Message kept offline: brain server is unavailable")
    }

    @Synchronized fun close() {
        closedByUser = true
        handler.removeCallbacksAndMessages(null)
        socket?.close(1000, "service stopped")
        socket = null
        owner = null
        applicationContext = null
        updateStatus("Offline")
    }

    private fun updateStatus(status: String) {
        connectionStatus = status
        owner?.dispatchConnectionStatus(status)
    }
}
