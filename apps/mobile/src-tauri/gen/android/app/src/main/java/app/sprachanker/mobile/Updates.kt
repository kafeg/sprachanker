package app.sprachanker.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import org.json.JSONObject

// A newer version of the app installed from the page (`sprachankerUpdates`; apps/mobile/src/update.ts):
// the release's APK downloaded over HTTPS — only from the project's own release downloads, every
// redirect HTTPS too —, checked against the sha256 GitHub gives for it, then handed to Android's
// installer, which asks the learner and installs it over this app only when it is signed with the same
// key and its version code is higher (no downgrade); the app's files stay. Android asks once to let
// the app install apps (REQUEST_INSTALL_PACKAGES): its settings screen is opened and the install goes
// on when that is granted. The answer, "" or why it failed, goes through `sprachankerNative.done`;
// the app's own page alone is answered (Native.kt's `guard`).
class Updates(private val activity: Activity, private val webView: WebView, private val guard: () -> Unit) {
  private val pool = Executors.newSingleThreadExecutor()

  private fun answer(id: Int, text: String) {
    val json = JSONObject.quote(text)
    webView.post { webView.evaluateJavascript("window.sprachankerNative&&window.sprachankerNative.done($id,$json)", null) }
  }

  /** Downloads `url` (`size` bytes, `sha256` hex) and starts the system's installer with it. */
  @JavascriptInterface fun install(id: Int, url: String, sha256: String, size: Long) {
    guard()
    pool.execute {
      val failure = try {
        if (!isRelease(url)) throw IOException("not a release of the app: $url")
        if (!Regex("^[0-9a-f]{64}$").matches(sha256)) throw IOException("no sha256 for $url")
        val apk = download(url, sha256, size)
        if (!activity.packageManager.canRequestPackageInstalls()) allowInstalls()
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apk)
        activity.startActivity(
          Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        ""
      } catch (e: Exception) {
        e.message ?: e.javaClass.simpleName
      }
      answer(id, failure)
    }
  }

  /** The APK in the app's cache (the one before it removed), its bytes summed as they come. */
  private fun download(url: String, sha256: String, size: Long): File {
    val dir = File(activity.cacheDir, "updates")
    dir.deleteRecursively()
    dir.mkdirs()
    val apk = File(dir, "SprachAnker.apk")
    var target = URL(url)
    var connection: HttpURLConnection
    var hops = 0
    while (true) {
      if (target.protocol != "https") throw IOException("not HTTPS: $target")
      connection = target.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 30_000
      connection.readTimeout = 120_000
      val status = connection.responseCode
      val location = connection.getHeaderField("Location")
      if (status in 300..399 && location != null && hops < 10) {
        hops++
        target = URL(target, location)
        connection.disconnect()
        continue
      }
      if (status != 200) throw IOException("HTTP $status")
      break
    }
    val digest = MessageDigest.getInstance("SHA-256")
    var total = 0L
    connection.inputStream.use { input ->
      apk.outputStream().use { output ->
        val buffer = ByteArray(1 shl 16)
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          total += n
          if (total > size) throw IOException("larger than the release says")
          digest.update(buffer, 0, n)
          output.write(buffer, 0, n)
        }
      }
    }
    val sum = digest.digest().joinToString("") { "%02x".format(it) }
    if (total != size || sum != sha256) {
      apk.delete()
      throw IOException("the download is not the release's file")
    }
    return apk
  }

  /** Android's screen to let this app install apps, waited on (two minutes at most). */
  private fun allowInstalls() {
    activity.startActivity(
      Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    val until = System.currentTimeMillis() + 120_000
    while (!activity.packageManager.canRequestPackageInstalls()) {
      if (System.currentTimeMillis() > until) throw IOException("installing apps from SprachAnker was not allowed")
      Thread.sleep(500)
    }
  }

  /** A release download of the app's own: parsed, normalised, unchanged by it (no `..` or escapes
   *  climbing out), over HTTPS. */
  private fun isRelease(url: String): Boolean {
    if (Regex("%2e|\\.\\.|\\\\", RegexOption.IGNORE_CASE).containsMatchIn(url)) return false
    return try {
      val uri = URI(url)
      uri.normalize() == uri && uri.scheme == "https" && uri.host == "github.com" && uri.rawUserInfo == null &&
        uri.port == -1 && (uri.rawPath ?: "").startsWith(RELEASES_PATH)
    } catch (e: Exception) {
      false
    }
  }

  companion object {
    const val RELEASES_PATH = "/kafeg/sprachanker/releases/download/"
  }
}
