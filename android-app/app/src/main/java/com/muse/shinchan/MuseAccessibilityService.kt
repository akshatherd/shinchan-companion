package com.muse.shinchan

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.graphics.Rect
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

class MuseAccessibilityService : AccessibilityService() {
    companion object { @Volatile var instance:MuseAccessibilityService?=null }
    @Volatile private var routineActive=false
    @Volatile private var sensitiveScreenActive=false
    override fun onServiceConnected(){instance=this;OverlayHolder.accessibility=this;serviceInfo=serviceInfo.apply { eventTypes=eventTypes or AccessibilityEvent.TYPE_TOUCH_INTERACTION_START }}
    fun attach(service:OverlayCompanionService){OverlayHolder.service=service}
    fun setRoutineActive(active:Boolean){routineActive=active}
    override fun onAccessibilityEvent(event:AccessibilityEvent?){if(event==null)return
        if(routineActive && event.eventType==AccessibilityEvent.TYPE_TOUCH_INTERACTION_START){routineActive=false;OverlayHolder.service?.stopRoutine();return}
        val pkg=event.packageName?.toString().orEmpty()
        val windowChanged = event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || event.eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED
        val passwordFocused = (event.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED || event.eventType == AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED) &&
            (event.source?.let { source -> val value = source.isPassword; source.recycle(); value } ?: false)
        if (passwordFocused) {
            sensitiveScreenActive = true
            OverlayHolder.service?.setPrivacySuppressed(true)
        } else if (windowChanged) {
            sensitiveScreenActive = isSensitivePackage(pkg)
            OverlayHolder.service?.setPrivacySuppressed(sensitiveScreenActive)
        }
        val excluded = isExcluded(pkg) || sensitiveScreenActive || passwordFocused
        if (windowChanged && pkg != lastPackage && !excluded) {
            lastPackage = pkg
            val category = when {
                listOf("youtube", "netflix", "twitch", "video", "media").any { pkg.contains(it, true) } -> "video"
                listOf("mail", "calendar", "docs", "office", "slack", "teams").any { pkg.contains(it, true) } -> "work"
                else -> "general"
            }
            OverlayHolder.service?.dispatchAutonomyEvent(JSONObject().put("type", "FOREGROUND_APP_CATEGORY").put("category", category))
        }
        if(excluded || getSharedPreferences("muse",MODE_PRIVATE).getBoolean("pauseLearning",false))return
        if(event.eventType==AccessibilityEvent.TYPE_TOUCH_INTERACTION_START) OverlayHolder.service?.dispatchAutonomyEvent(JSONObject().put("type","TOUCH_TAP"))
        if(event.eventType==AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) OverlayHolder.service?.dispatchAutonomyEvent(JSONObject().put("type","HOUR_OF_DAY").put("hour",java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)))
        val nodes=JSONArray();event.source?.let{root->capture(root,nodes,0,pkg,event.eventType);root.recycle()}
        if(nodes.length()>0)OverlayHolder.service?.sendJson(JSONObject().put("type","TRACE").put("userId","local").put("events",nodes))
    }
    @Volatile private var lastPackage = ""
    private fun capture(n:AccessibilityNodeInfo,out:JSONArray,depth:Int,packageName:String,eventType:Int){if(depth>10)return
        if(!n.isPassword){val b=Rect();n.getBoundsInScreen(b);out.put(JSONObject().put("packageName",packageName).put("viewIdResourceName",n.viewIdResourceName?:"").put("className",n.className?.toString().orEmpty()).put("text",n.text?.toString()?.take(160)?:"").put("contentDescription",n.contentDescription?.toString()?.take(160)?:"").put("boundsInScreen",JSONObject().put("left",b.left).put("top",b.top).put("right",b.right).put("bottom",b.bottom)).put("timestamp",System.currentTimeMillis()/1000.0).put("eventType",eventTypeName(eventType)).put("isPassword",false))}
        for(i in 0 until n.childCount)n.getChild(i)?.let{child->capture(child,out,depth+1,packageName,eventType);child.recycle()}
    }
    private fun isExcluded(pkg:String):Boolean {
        val defaults=listOf("bank","wallet","phonepe","paytm","gpay","paisa","password","bitwarden","1password","lastpass","keepass","authenticator")
        val configured=getSharedPreferences("muse",MODE_PRIVATE).getString("excludedApps","").orEmpty().split(',').map{it.trim()}.filter{it.isNotEmpty()}
        return pkg.isBlank() || pkg==packageName || defaults.any{pkg.contains(it,true)} || configured.any{pkg.equals(it,true)}
    }
    private fun isSensitivePackage(pkg:String):Boolean {
        val defaults=listOf("bank","wallet","phonepe","paytm","gpay","paisa","password","bitwarden","1password","lastpass","keepass","authenticator")
        val configured=getSharedPreferences("muse",MODE_PRIVATE).getString("excludedApps","").orEmpty().split(',').map{it.trim()}.filter{it.isNotEmpty()}
        return pkg.isNotBlank() && pkg != packageName && (defaults.any{pkg.contains(it,true)} || configured.any{pkg.equals(it,true)})
    }
    private fun eventTypeName(type:Int)=when(type){AccessibilityEvent.TYPE_VIEW_CLICKED->"view_clicked";AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED->"view_text_changed";AccessibilityEvent.TYPE_VIEW_FOCUSED->"view_focused";AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED->"window_state_changed";else->"window_content_changed"}
    fun dispatchApprovedTap(x:Float,y:Float,callback:((Boolean)->Unit)?=null){if(Build.VERSION.SDK_INT<24){callback?.invoke(false);return};val path=Path().apply{moveTo(x,y)};val gesture=GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path,0,55)).build();val accepted=dispatchGesture(gesture,object:GestureResultCallback(){override fun onCompleted(g:GestureDescription){callback?.invoke(true)};override fun onCancelled(g:GestureDescription){callback?.invoke(false)}},null);if(!accepted)callback?.invoke(false)}
    fun tapView(view:View,callback:(Boolean)->Unit){val bounds=Rect();if(!view.getGlobalVisibleRect(bounds)||bounds.isEmpty){callback(false);return};dispatchApprovedTap(bounds.exactCenterX(),bounds.exactCenterY(),callback)}
    override fun onInterrupt(){routineActive=false}
    override fun onDestroy(){instance=null;OverlayHolder.accessibility=null;super.onDestroy()}
}
internal object OverlayHolder { @Volatile var service:OverlayCompanionService?=null; @Volatile var accessibility:MuseAccessibilityService?=null }
