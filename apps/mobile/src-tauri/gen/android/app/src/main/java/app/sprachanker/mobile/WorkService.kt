package app.sprachanker.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

// While the app downloads (a course, a model) or moves a large file, Android is told it works for the
// learner: a notification of its own, the process kept at a foreground's priority and its network
// let through when the app is put away (else the system cuts both a minute or so after). Stopped when
// the work ends; the system may still end it (low memory, the learner closing the app).
class WorkService : Service() {
  private var lock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(TEXT) ?: "SprachAnker"
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26)
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "SprachAnker", NotificationManager.IMPORTANCE_LOW),
      )
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL)
    else @Suppress("DEPRECATION") Notification.Builder(this)
    val notification = builder
      .setContentTitle(text)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentIntent(open)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= 29)
      startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(1, notification)
    if (lock == null) {
      lock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sprachanker:work")
        .also { it.acquire(6 * 60 * 60 * 1000L) }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    lock?.let { if (it.isHeld) it.release() }
    lock = null
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "work"
    private const val TEXT = "text"

    fun start(context: Context, text: String) {
      val intent = Intent(context, WorkService::class.java).putExtra(TEXT, text)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, WorkService::class.java))
    }
  }
}
