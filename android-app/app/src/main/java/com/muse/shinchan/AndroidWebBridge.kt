package com.muse.shinchan

import android.webkit.JavascriptInterface
import org.json.JSONObject

class AndroidWebBridge(private val service: OverlayCompanionService) {
    @JavascriptInterface fun pageReady() { service.markPageReady() }
    @JavascriptInterface fun healthPing(): String { MuseLog.writeTagged(service, "SHN_BRIDGE", "JS->Android healthPing succeeded"); return "ok" }
    @JavascriptInterface fun reportPageTap(x: Float, y: Float) { MuseLog.writeTagged(service, "SHN_TOUCH", "page received tap at (${x.toInt()},${y.toInt()})") }
    @JavascriptInterface fun confirmTap(x: Float, y: Float) {
        MuseLog.writeTagged(service, "SHN_A11Y", "tap requested at (${x.toInt()},${y.toInt()})")
        val point = service.mapOverlayPoint(x, y)
        val accessibility = MuseAccessibilityService.instance
        if (accessibility == null) service.onTapResult(false)
        else accessibility.dispatchApprovedTap(point.first, point.second) { completed -> service.onTapResult(completed) }
    }
    @JavascriptInterface fun setInteractiveBounds(left: Float, top: Float, width: Float, height: Float) { service.setInteractiveBounds(left, top, width, height) }
    @JavascriptInterface fun resizeWindow(widthDp: Int, heightDp: Int) { service.resizeWindow(widthDp, heightDp) }
    @JavascriptInterface fun reportError(message: String) { MuseLog.write(service, "Overlay error: ${message.take(500)}", IllegalStateException(message.take(500))) }
    @JavascriptInterface fun setOverlayMode(mode: String) { if (mode == "expanded") service.setWindowMode(true, false) else service.setWindowMode(false, mode == "permission") }
    @JavascriptInterface fun mascotTouched() { service.setInteractive(true) }
    @JavascriptInterface fun startVoiceInput() { MuseLog.writeTagged(service, "SHN_STT", "voice input requested from page"); service.startVoiceInput() }
    @JavascriptInterface fun reportCorrection(reward: Float) { service.sendJson(JSONObject().put("type","CORRECTION").put("reward",reward)) }
    @JavascriptInterface fun stateChanged(state: String) { service.onState(state) }
    @JavascriptInterface fun permissionResult(actionId: String, approved: Boolean) { service.sendJson(JSONObject().put("type","PERMISSION_RESULT").put("actionId",actionId).put("approved",approved)); if (approved) service.onPermissionApproved(actionId) }
    @JavascriptInterface fun sendToServer(json: String) { try { val payload = JSONObject(json); MuseLog.writeTagged(service, "SHN_BRIDGE", "JS->Android ${payload.optString("type")}"); service.sendJson(payload) } catch (error: Exception) { MuseLog.writeTagged(service, "SHN_BRIDGE", "invalid JS bridge JSON", error) } }
}
