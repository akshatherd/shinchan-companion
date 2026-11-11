package com.muse.shinchan

import android.app.Service
import android.content.Intent
import android.os.IBinder

class StopRoutineService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == OverlayCompanionService.ACTION_STOP) OverlayHolder.service?.stopShinchan()
        else OverlayHolder.service?.stopRoutine()
        stopSelf(startId)
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
