package app.sprachanker.mobile

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.Process

// While the app downloads (a course, a model) or moves a large file, or is open to other devices,
// Android is told it works for the learner: a notification of its own, the process kept at a
// foreground's priority and its network let through when the app is put away (else the system cuts
// both a minute or so after). A download holds the CPU awake too; serving others does not (a request
// from the network wakes it). Stopped when neither goes on; the system may still end it (low memory).
// Closing the app — the notification's button, or taking it off the recent apps — ends it all.
class WorkService : Service() {
  private var lock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == QUIT) {
      quit()
      return START_NOT_STICKY
    }
    val doing = work
    val open = hosting
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, "SprachAnker", NotificationManager.IMPORTANCE_LOW),
    )
    val show = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = Notification.Builder(this, CHANNEL)
      .setContentTitle(doing ?: open?.text ?: "SprachAnker")
      .setSmallIcon(if (doing != null) android.R.drawable.stat_sys_download else android.R.drawable.stat_notify_sync_noanim)
      .setContentIntent(show)
      .setOngoing(true)
    if (open != null) {
      val close = PendingIntent.getService(
        this, 1, Intent(this, WorkService::class.java).setAction(QUIT), PendingIntent.FLAG_IMMUTABLE,
      )
      notification.addAction(
        Notification.Action.Builder(
          Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), open.quit, close,
        ).build(),
      )
    }
    // Android 14 and later: a download is data sync (six hours at most on Android 15), serving
    // others a special use; before, the manifest's types.
    val type =
      if (Build.VERSION.SDK_INT >= 34)
        (if (doing != null) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0) or
          (if (open != null) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
      else ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
    startForeground(1, notification.build(), type)
    if (doing != null && lock == null) {
      lock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sprachanker:work")
        .also { it.acquire(6 * 60 * 60 * 1000L) }
    } else if (doing == null) release()
    return START_NOT_STICKY
  }

  // Android 15 ends a data sync's service after six hours: it stops (the work goes on while the app
  // is open).
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  // The app taken off the recent apps: closed, its listener with it.
  override fun onTaskRemoved(rootIntent: Intent?) {
    quit()
  }

  /** The app closed: its page given a moment to write what it changed last, then the process ends. */
  private fun quit() {
    work = null
    hosting = null
    release()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    (getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).appTasks.forEach { it.finishAndRemoveTask() }
    Handler(Looper.getMainLooper()).postDelayed({ Process.killProcess(Process.myPid()) }, 1_000)
  }

  private fun release() {
    lock?.let { if (it.isHeld) it.release() }
    lock = null
  }

  override fun onDestroy() {
    release()
    super.onDestroy()
  }

  /** The notification's words while the app is open to other devices. */
  data class Hosting(val text: String, val quit: String)

  companion object {
    private const val CHANNEL = "work"
    private const val QUIT = "quit"

    /** What is being done (a download), shown first; null when nothing. */
    @Volatile private var work: String? = null
    @Volatile private var hosting: Hosting? = null

    fun start(context: Context, text: String) {
      work = text
      show(context)
    }

    fun stop(context: Context) {
      work = null
      if (hosting == null) context.stopService(Intent(context, WorkService::class.java)) else show(context)
    }

    /** The app open to other devices (`words`) or not (null). */
    fun host(context: Context, words: Hosting?) {
      hosting = words
      if (words == null && work == null) context.stopService(Intent(context, WorkService::class.java))
      else show(context)
    }

    private fun show(context: Context) {
      // Refused (Android 12 and later, when the app is away already): the work goes on while the app
      // is open.
      try {
        context.startForegroundService(Intent(context, WorkService::class.java))
      } catch (e: Exception) {}
    }
  }
}
