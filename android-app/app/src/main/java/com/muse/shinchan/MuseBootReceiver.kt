package com.muse.shinchan

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class MuseBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!android.provider.Settings.canDrawOverlays(context)) {
            MuseLog.write(context, "Boot restore skipped: overlay permission is not enabled")
            return
        }
        runCatching { ContextCompat.startForegroundService(context, Intent(context, OverlayCompanionService::class.java)) }
            .onFailure { MuseLog.write(context, "Boot restore could not start overlay service: ${it.message}", it) }
    }
}
