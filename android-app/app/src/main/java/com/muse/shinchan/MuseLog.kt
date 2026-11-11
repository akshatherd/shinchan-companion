package com.muse.shinchan

import android.content.Context
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object MuseLog {
    private const val TAG = "ShinchanMUSE"
    private const val PREFS = "muse"
    private const val KEY_LOG = "recentDiagnostics"

    @Synchronized fun write(context: Context, message: String, error: Throwable? = null) {
        writeTagged(context, TAG, message, error)
    }

    @Synchronized fun writeTagged(context: Context, tag: String, message: String, error: Throwable? = null) {
        if (error == null) Log.i(tag, message) else Log.e(tag, message, error)
        val stamp = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val lines = prefs.getString(KEY_LOG, "").orEmpty().lines().filter { it.isNotBlank() }.toMutableList()
        lines += "$stamp  [$tag] $message"
        prefs.edit().putString(KEY_LOG, lines.takeLast(50).joinToString("\n")).apply()
    }

    fun read(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LOG, "").orEmpty()
}
