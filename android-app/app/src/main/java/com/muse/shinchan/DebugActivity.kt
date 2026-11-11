package com.muse.shinchan

import android.graphics.Color
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class DebugActivity : AppCompatActivity() {
    private var debugWebView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        debugWebView = WebView(this).apply {
            setBackgroundColor(Color.rgb(15, 23, 42))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest) = loader.shouldInterceptRequest(request.url)
                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: android.webkit.WebResourceError?) {
                    if (request?.isForMainFrame == true) MuseLog.write(this@DebugActivity, "Debug WebView page error: ${error?.description}")
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                    val allowed = ContextCompat.checkSelfPermission(this@DebugActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    if (allowed && request.resources.all { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }) request.grant(request.resources)
                    else request.deny()
                }
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    MuseLog.write(this@DebugActivity, "Debug Web ${message.messageLevel()}: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                    return true
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/overlay/index.html?mode=debug")
        }
        setContentView(debugWebView!!, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    override fun onDestroy() {
        debugWebView?.apply { stopLoading(); webChromeClient = null; webViewClient = WebViewClient(); destroy() }
        debugWebView = null
        super.onDestroy()
    }
}
