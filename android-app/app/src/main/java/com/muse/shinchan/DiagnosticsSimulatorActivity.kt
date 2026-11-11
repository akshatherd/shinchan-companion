package com.muse.shinchan

import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class DiagnosticsSimulatorActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply { isFillViewport = true; fitsSystemWindows = true }
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 32, 32, 32) }
        scroll.addView(content)
        setContentView(scroll)
        content.addView(TextView(this).apply { text = "Diagnostics & Event Simulator"; textSize = 24f; setPadding(0, 0, 0, 20) })
        val logs = TextView(this).apply { textSize = 13f; text = MuseLog.read(this@DiagnosticsSimulatorActivity).ifBlank { "Ready. Trigger an event to see it here." } }
        val simulatorEvents = listOf(
            "Screen unlock" to JSONObject().put("type", "SCREEN_UNLOCK"),
            "Charging" to JSONObject().put("type", "CHARGING_STATE").put("charging", true),
            "Video app" to JSONObject().put("type", "FOREGROUND_APP_CATEGORY").put("category", "video"),
            "Late night" to JSONObject().put("type", "HOUR_OF_DAY").put("hour", 23),
            "Low battery" to JSONObject().put("type", "LOW_BATTERY"),
            "Poke test" to JSONObject().put("type", "TOUCH_TAP"),
            "Dance silly" to JSONObject().put("type", "DANCE_SILLY"),
            "Voice test" to JSONObject().put("type", "VOICE_TEST")
        )
        simulatorEvents.forEach { (label, event) ->
            content.addView(Button(this).apply { text = label; minHeight = 52; setOnClickListener {
                OverlayHolder.service?.dispatchAutonomyEvent(event)
                if (event.optString("type") == "VOICE_TEST") OverlayHolder.service?.startVoiceInput()
                MuseLog.write(this@DiagnosticsSimulatorActivity, "Simulator event: $label")
                logs.text = MuseLog.read(this@DiagnosticsSimulatorActivity)
            } }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        content.addView(Button(this).apply { text = "Refresh logs"; setOnClickListener { logs.text = MuseLog.read(this@DiagnosticsSimulatorActivity) } })
        content.addView(logs, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }
}
