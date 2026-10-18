package app.sprachanker.mobile

import android.app.Activity
import android.content.ContentValues
import android.os.StatFs
import android.provider.MediaStore
import android.widget.Toast
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.URL
import java.nio.charset.StandardCharsets
import java.nio.file.DirectoryNotEmptyException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.CRC32
import org.json.JSONArray
import org.json.JSONObject

// The page's native side for what the shared code (course-kit's DataFs, the server's outbound
// requests) asks of the phone: the app's files — small things answered at once, as the page's code is
// synchronous there; bytes as Latin-1 strings (one char a byte) — and requests to other hosts made
// here, outside the WebView's CORS. Paths stay under the app's data root. A failure is "CODE message"
// (Node's codes); work that takes long answers through `window.sprachankerNative.done`.
class Native(private val activity: Activity, private val webView: WebView, private val root: String) {
  private val pool = Executors.newCachedThreadPool()

  // The bridge answers the app's own page alone. The WebView shows no other (lib.rs keeps it on the
  // app's pages, the CSP lets no frame in), and should one be there, every call is refused: the page
  // in the main frame (as wry's client saw it start) must be of the app's origin.
  @Volatile private var client: RustWebViewClient? = null
  private fun ownPage(): Boolean {
    val c = client ?: run {
      // The WebView's own thread asked once (its client is set after the bridge is added).
      val got = CountDownLatch(1)
      webView.post {
        client = webView.webViewClient as? RustWebViewClient
        got.countDown()
      }
      got.await(5, TimeUnit.SECONDS)
      client
    } ?: return false
    val url = c.currentUrl
    return url == ORIGIN || url.startsWith("$ORIGIN/")
  }
  /** Refuses a call from any page but the app's own (Voices.kt's too). */
  fun guard() {
    if (!ownPage()) throw IOException("EACCES not the app's own page")
  }

  private fun under(path: String): File {
    guard()
    if (path != root && !path.startsWith("$root/")) throw IOException("EACCES outside the app's files: $path")
    if (path.split('/').any { it == ".." || it == "." }) throw IOException("EACCES $path")
    return File(path)
  }

  /** A path that may be changed: under the root, never the root itself. */
  private fun inside(path: String): File {
    guard()
    if (!path.startsWith("$root/")) throw IOException("EACCES not inside the app's files: $path")
    if (path.split('/').any { it == ".." || it == "." }) throw IOException("EACCES $path")
    return File(path)
  }

  private fun failure(e: Throwable): String {
    val code = when (e) {
      is NoSuchFileException, is java.io.FileNotFoundException -> "ENOENT"
      is FileAlreadyExistsException -> "EEXIST"
      is DirectoryNotEmptyException -> "ENOTEMPTY"
      is ErrnoException -> OsConstants.errnoName(e.errno) ?: "EIO"
      else -> {
        val cause = e.cause
        if (cause is ErrnoException) OsConstants.errnoName(cause.errno) ?: "EIO"
        else if ((e.message ?: "").contains("ENOSPC") || (e.message ?: "").contains("No space")) "ENOSPC"
        else if (Regex("^E[A-Z]+ ").containsMatchIn(e.message ?: "")) e.message!!.substringBefore(' ')
        else "EIO"
      }
    }
    return "$code ${e.message ?: e.javaClass.simpleName}"
  }

  private inline fun attempt(block: () -> Unit): String =
    try {
      block()
      ""
    } catch (e: Throwable) {
      failure(e)
    }

  private fun latin1(bytes: ByteArray, n: Int = bytes.size) = String(bytes, 0, n, StandardCharsets.ISO_8859_1)
  private fun bytesOf(text: String) = text.toByteArray(StandardCharsets.ISO_8859_1)

  private fun answer(id: Int, json: String) {
    webView.post { webView.evaluateJavascript("window.sprachankerNative&&window.sprachankerNative.done($id,$json)", null) }
  }

  @JavascriptInterface fun root(): String = if (ownPage()) root else ""

  private var working = 0

  /** Work begun (`on`) or ended that must go on while the app is put away — a download: a
   *  foreground service while any runs (WorkService). */
  @JavascriptInterface fun work(on: Boolean, text: String) {
    guard()
    synchronized(this) {
      working = maxOf(0, working + if (on) 1 else -1)
      if (on && working == 1) WorkService.start(activity, text)
      // Stopped a moment later, when nothing began again: a service stopped before it has shown its
      // notification ends the app on Android 12 and later.
      if (!on && working == 0) webView.postDelayed({ synchronized(this) { if (working == 0) WorkService.stop(activity) } }, 2_000)
      if (working == 0 || (on && working == 1)) keepRenderer()
    }
  }

  private var reading = 0

  /** An engine began reading aloud (`on`) or ended — Qwen3-TTS's or Piper's program at work (a
   *  deck's words, practice made on the phone, a reading): the CPU kept running while any reads, so
   *  a reading with the screen off takes as long as with it on (asleep, the phone took minutes a
   *  word). Let go a moment after the last, when no other began; at most READING_MS after the last
   *  began (a page gone mid-reading). */
  @JavascriptInterface fun reading(on: Boolean) {
    guard()
    synchronized(this) {
      reading = maxOf(0, reading + if (on) 1 else -1)
      if (on) WorkService.awake(activity, "reading", true, READING_MS)
      if (!on && reading == 0)
        webView.postDelayed({ synchronized(this) { if (reading == 0) WorkService.awake(activity, "reading", false) } }, 2_000)
      if (reading == 0 || (on && reading == 1)) keepRenderer()
    }
  }

  private var hosting = false

  /** The page's renderer kept as important as the app while work goes on, an engine reads or the app
   *  is open to other devices: else Android freezes it as soon as the app is put away or the screen
   *  goes off (measured: the download stood still till the app came back). */
  private fun keepRenderer() {
    val keep = working > 0 || reading > 0 || hosting
    webView.post { webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !keep) }
  }

  /** The app open to other devices (`on`, its listener in the native side): a foreground service
   *  while it is, its notification in the page's words — `text`, `quit` the button that closes the
   *  app (WorkService). */
  @JavascriptInterface fun host(on: Boolean, text: String, quit: String) {
    guard()
    synchronized(this) {
      hosting = on
      keepRenderer()
    }
    WorkService.host(activity, if (on) WorkService.Hosting(text, quit) else null)
  }

  /** The phone's IPv4 addresses on its networks: "<interface> <address>" a line (loopback and the
   *  networks that are down left out). */
  @JavascriptInterface fun addresses(): String {
    guard()
    val out = StringBuilder()
    for (n in NetworkInterface.getNetworkInterfaces() ?: return "") {
      if (!n.isUp || n.isLoopback) continue
      for (a in n.inetAddresses) if (a is Inet4Address) out.append(n.name).append(' ').append(a.hostAddress).append('\n')
    }
    return out.toString()
  }

  /** An IPv4 address's name on its network (Tailscale's MagicDNS name), answered to `id` as a JSON
   *  string: "" when it has none. */
  @JavascriptInterface fun nameOf(id: Int, ip: String) {
    guard()
    if (!Regex("^\\d{1,3}(\\.\\d{1,3}){3}$").matches(ip)) return answer(id, "\"\"")
    pool.execute {
      val name = try { InetAddress.getByName(ip).canonicalHostName.trimEnd('.') } catch (e: Throwable) { ip }
      answer(id, JSONObject.quote(if (name == ip) "" else name))
    }
  }

  /** "" when nothing is there, else "<size> <mtime ms> <d|f>". */
  @JavascriptInterface fun stat(path: String): String {
    val f = try { under(path) } catch (e: IOException) { return "" }
    if (!f.exists()) return ""
    return "${if (f.isDirectory) 0 else f.length()} ${f.lastModified()} ${if (f.isDirectory) "d" else "f"}"
  }

  /** The names in a folder, one a line. */
  @JavascriptInterface fun list(path: String): String {
    val f = try { under(path) } catch (e: IOException) { return "" }
    return f.list()?.joinToString("\n") ?: ""
  }

  /** What is in a folder: "<name>\t<size>\t<mtime>\t<d|f>" a line. */
  @JavascriptInterface fun dir(path: String): String {
    val f = try { under(path) } catch (e: IOException) { return "" }
    val out = StringBuilder()
    for (e in f.listFiles() ?: return "") {
      val d = e.isDirectory
      out.append(e.name).append('\t').append(if (d) 0 else e.length()).append('\t')
        .append(e.lastModified()).append('\t').append(if (d) 'd' else 'f').append('\n')
    }
    return out.toString()
  }

  /** Every file under a folder:"<path relative to it>\t<size>\t<mtime>" a line. */
  @JavascriptInterface fun walk(path: String): String {
    val base = try { under(path) } catch (e: IOException) { return "" }
    val out = StringBuilder()
    fun go(dir: File, rel: String) {
      for (f in dir.listFiles() ?: return) {
        val r = if (rel.isEmpty()) f.name else "$rel/${f.name}"
        if (f.isDirectory) go(f, r) else out.append(r).append('\t').append(f.length()).append('\t').append(f.lastModified()).append('\n')
      }
    }
    go(base, "")
    return out.toString()
  }

  @JavascriptInterface fun readText(path: String): String? = try {
    val f = under(path)
    if (f.isFile) String(f.readBytes(), StandardCharsets.UTF_8) else null
  } catch (e: Throwable) { null }

  /** `length` bytes from `start` (fewer at the end), Latin-1; null when there is no file. A file that
   *  cannot be read (memory) is an error the page sees, never taken for none. */
  @JavascriptInterface fun readBytes(path: String, start: Double, length: Double): String? = run {
    val f = under(path)
    if (!f.isFile) null else RandomAccessFile(f, "r").use { r ->
      val from = start.toLong()
      val n = maxOf(0L, minOf(length.toLong(), r.length() - from)).toInt()
      val buf = ByteArray(n)
      r.seek(from)
      r.readFully(buf)
      latin1(buf)
    }
  }

  private fun writeWhole(path: String, bytes: ByteArray) {
    val f = under(path)
    f.parentFile?.mkdirs()
    val part = File("${f.path}.part")
    try {
      FileOutputStream(part).use { it.write(bytes); it.fd.sync() }
      if (!part.renameTo(f)) {
        Files.move(part.toPath(), f.toPath(), StandardCopyOption.REPLACE_EXISTING)
      }
    } finally {
      // Whole or not at all: a part left by a failure goes.
      if (part.exists()) part.delete()
    }
  }

  @JavascriptInterface fun writeText(path: String, text: String) = attempt { writeWhole(path, text.toByteArray(StandardCharsets.UTF_8)) }
  @JavascriptInterface fun writeBytes(path: String, data: String) = attempt { writeWhole(path, bytesOf(data)) }
  @JavascriptInterface fun mkdir(path: String) = attempt { Files.createDirectories(under(path).toPath()) }
  @JavascriptInterface fun rename(from: String, to: String) = attempt { Os.rename(inside(from).path, inside(to).path) }
  @JavascriptInterface fun remove(path: String) = attempt {
    val f = inside(path)
    if (f.isDirectory) { if (!f.deleteRecursively()) throw IOException("EIO could not remove $path") }
    else if (f.exists() && !f.delete()) throw IOException("EIO could not remove $path")
  }
  @JavascriptInterface fun removeDir(path: String) = attempt { Files.delete(inside(path).toPath()) }
  @JavascriptInterface fun link(from: String, to: String) = attempt { Os.link(under(from).path, under(to).path) }
  @JavascriptInterface fun copy(from: String, to: String) = attempt { Files.copy(under(from).toPath(), under(to).toPath()) }
  @JavascriptInterface fun touch(path: String) = attempt {
    val f = under(path)
    if (!f.exists()) throw NoSuchFileException(path)
    if (!f.setLastModified(System.currentTimeMillis())) throw IOException("EIO cannot touch $path")
  }

  /** "<free> <size>" of the disk the path is on. */
  @JavascriptInterface fun disk(path: String): String = try {
    val s = StatFs(under(path).let { var f = it; while (!f.exists()) f = f.parentFile ?: break; f }.path)
    "${s.availableBytes} ${s.totalBytes}"
  } catch (e: Throwable) { "" }

  // Files written in parts: opened, each part appended, closed with their sha256.
  private class Sink(
    val out: OutputStream,
    val hash: MessageDigest,
    var size: Long,
    /** Once the file is whole (a download made visible), or let go. */
    val finish: () -> Unit = {},
    val drop: () -> Unit = {},
  )
  private val sinks = ConcurrentHashMap<Int, Sink>()
  private var nextSink = 1

  /** A new file to write (folders made, one there replaced): its handle, or "!CODE message". */
  @JavascriptInterface fun openWrite(path: String): String = try {
    val f = under(path)
    f.parentFile?.mkdirs()
    val id = synchronized(this) { nextSink++ }
    sinks[id] = Sink(FileOutputStream(f), MessageDigest.getInstance("SHA-256"), 0)
    id.toString()
  } catch (e: Throwable) { "!${failure(e)}" }

  @JavascriptInterface fun append(handle: Int, data: String): String {
    if (!ownPage()) return "EACCES not the app's own page"
    val sink = sinks[handle] ?: return "EBADF no such file"
    return attempt {
      val bytes = bytesOf(data)
      sink.out.write(bytes)
      sink.hash.update(bytes)
      sink.size += bytes.size
    }
  }

  /** "<sha256> <size>", or "!CODE message". */
  @JavascriptInterface fun closeWrite(handle: Int, sync: Boolean): String {
    if (!ownPage()) return "!EACCES not the app's own page"
    val sink = sinks.remove(handle) ?: return "!EBADF no such file"
    return try {
      if (sync) (sink.out as? FileOutputStream)?.fd?.sync()
      sink.out.close()
      sink.finish()
      "${sink.hash.digest().joinToString("") { "%02x".format(it) }} ${sink.size}"
    } catch (e: Throwable) { "!${failure(e)}" }
  }

  @JavascriptInterface fun abortWrite(handle: Int) {
    if (!ownPage()) return
    val sink = sinks.remove(handle) ?: return
    try { sink.out.close() } catch (e: Throwable) {}
    try { sink.drop() } catch (e: Throwable) {}
  }

  /** A file saved into the phone's Downloads (a file exported: a course, a deck, a profile), written
   *  as `openWrite`'s are; seen by other apps once closed, and said so. Its handle, or "!CODE message". */
  @JavascriptInterface fun openDownload(given: String, mime: String): String = try {
    guard()
    // A name, never a path: no folder of its own, no hidden or parent one.
    val name = given.replace(Regex("[/\\\\\\x00-\\x1f]"), "_").trimStart('.').ifEmpty { "sprachanker" }
    val id = synchronized(this) { nextSink++ }
    val resolver = activity.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, name)
      put(MediaStore.Downloads.MIME_TYPE, mime)
      put(MediaStore.Downloads.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IOException("EIO Downloads refused $name")
    val out = resolver.openOutputStream(uri) ?: throw IOException("EIO Downloads refused $name")
    sinks[id] = Sink(out, MessageDigest.getInstance("SHA-256"), 0, finish = {
      resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
      activity.runOnUiThread { Toast.makeText(activity, "↓ $name", Toast.LENGTH_LONG).show() }
    }, drop = { resolver.delete(uri, null, null) })
    id.toString()
  } catch (e: Throwable) { "!${failure(e)}" }

  private fun sumsOf(path: String): String = try {
    val hash = MessageDigest.getInstance("SHA-256")
    val crc = CRC32()
    var size = 0L
    val buf = ByteArray(1 shl 20)
    under(path).inputStream().use { input ->
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        hash.update(buf, 0, n)
        crc.update(buf, 0, n)
        size += n
      }
    }
    JSONObject().put("sha256", hash.digest().joinToString("") { "%02x".format(it) })
      .put("size", size).put("crc32", crc.value).toString()
  } catch (e: Throwable) { JSONObject().put("error", failure(e)).toString() }

  /** A file's sha256, size and CRC-32, answered to `id`: {sha256, size, crc32} or {error}. */
  @JavascriptInterface fun sums(id: Int, path: String) {
    pool.execute { answer(id, sumsOf(path)) }
  }

  /** The same at once (a small file: the answer's round trip would take longer than the reading). */
  @JavascriptInterface fun sumsNow(path: String): String = sumsOf(path)

  // Requests to other hosts: started here, their head answered to `id`, their body taken in parts.
  private class Pending(val connection: HttpURLConnection) {
    val parts = LinkedBlockingQueue<ByteArray>()
    val done = AtomicBoolean(false)
    @Volatile var error: String? = null
    @Volatile var waiting = false
    @Volatile var queued = 0L
    @Volatile var lastRead = System.currentTimeMillis()
  }
  private val requests = ConcurrentHashMap<Int, Pending>()
  /** Requests the page gave up before their head came. */
  private val dropped = HashSet<Int>()

  /** The bytes a request may hold unread before it waits for the page. */
  private val held = 8L shl 20
  /** A body the page has not read from this long is let go (a response the page dropped unread). */
  private val unread = 10L * 60_000

  /** A request (`init`: {method, headers: [[name, value]]}; `body`: Latin-1 or null) started: its
   *  head answered to `id` — {status, statusText, url, headers} or {error} —, then its body read by
   *  `netRead`. Redirects followed (to 10), across schemes too. */
  @JavascriptInterface fun netOpen(id: Int, url: String, init: String, body: String?) {
    guard()
    pool.execute {
      try {
        val spec = JSONObject(init)
        val method = spec.optString("method", "GET")
        val headers = spec.optJSONArray("headers") ?: JSONArray()
        val manual = spec.optBoolean("manual", false)
        var target = URL(url)
        var connection: HttpURLConnection
        var hops = 0
        var sentMethod = method
        var sentBody = body
        while (true) {
          connection = target.openConnection() as HttpURLConnection
          connection.instanceFollowRedirects = false
          connection.connectTimeout = 30_000
          connection.readTimeout = 300_000
          connection.requestMethod = sentMethod
          for (i in 0 until headers.length()) {
            val pair = headers.getJSONArray(i)
            val name = pair.getString(0)
            if (sentBody == null && name.equals("content-type", true)) continue
            connection.addRequestProperty(name, pair.getString(1))
          }
          if (sentBody != null) {
            val bytes = bytesOf(sentBody)
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
          }
          val status = connection.responseCode
          val location = connection.getHeaderField("Location")
          if (!manual && status in 300..399 && location != null && hops < 10) {
            hops++
            target = URL(target, location)
            if (status == 303 || ((status == 301 || status == 302) && sentMethod == "POST")) {
              sentMethod = "GET"
              sentBody = null
            }
            connection.disconnect()
            continue
          }
          break
        }
        val pending = Pending(connection)
        synchronized(dropped) {
          if (dropped.remove(id)) { connection.disconnect(); return@execute }
          requests[id] = pending
        }
        val head = JSONObject().put("status", connection.responseCode)
          .put("statusText", connection.responseMessage ?: "").put("url", target.toString())
        val list = JSONArray()
        for ((name, values) in connection.headerFields) {
          if (name == null) continue
          for (v in values) list.put(JSONArray().put(name).put(v))
        }
        head.put("headers", list)
        answer(id, head.toString())
        val input = try { connection.inputStream } catch (e: IOException) { connection.errorStream }
        try {
          if (input != null) {
            val buf = ByteArray(256 shl 10)
            while (!pending.done.get()) {
              val n = input.read(buf)
              if (n < 0) break
              synchronized(pending) {
                pending.parts.put(buf.copyOf(n))
                pending.queued += n
                if (pending.waiting) { pending.waiting = false; answer(id, "\"more\"") }
                while (pending.queued > held && !pending.done.get()) {
                  (pending as java.lang.Object).wait(1000)
                  if (System.currentTimeMillis() - pending.lastRead > unread) throw IOException("ETIMEDOUT the body was not read")
                }
              }
            }
          }
        } catch (e: Throwable) {
          pending.error = failure(e)
        } finally {
          try { input?.close() } catch (e: Throwable) {}
          pending.done.set(true)
          synchronized(pending) { if (pending.waiting) { pending.waiting = false; answer(id, "\"more\"") } }
        }
        // What the page leaves unread is let go after a while.
        while (requests[id] === pending && System.currentTimeMillis() - pending.lastRead < unread) Thread.sleep(5_000)
        if (requests.remove(id, pending)) pending.parts.clear()
      } catch (e: Throwable) {
        answer(id, JSONObject().put("error", failure(e)).toString())
      }
    }
  }

  /** What has come of a body, Latin-1 (at most about a megabyte); "" when nothing yet — `done(id,
   *  "more")` follows when more comes —; null at its end (`netError` then says whether it broke). */
  @JavascriptInterface fun netRead(id: Int): String? {
    guard()
    val p = requests[id] ?: return null
    val out = java.io.ByteArrayOutputStream()
    // Taken and the wait noted under the lock the reader adds under: a part cannot come between.
    synchronized(p) {
      p.lastRead = System.currentTimeMillis()
      while (out.size() < (1 shl 20)) {
        val part = p.parts.poll() ?: break
        out.write(part)
      }
      p.queued -= out.size()
      (p as java.lang.Object).notifyAll()
      if (out.size() == 0) {
        if (p.done.get()) return null
        p.waiting = true
        return ""
      }
    }
    return latin1(out.toByteArray())
  }

  /** After `netRead`'s null: why the body broke off ("" when it ended whole); the request let go. */
  @JavascriptInterface fun netError(id: Int): String = if (!ownPage()) "" else requests.remove(id)?.error ?: ""

  @JavascriptInterface fun netAbort(id: Int) {
    if (!ownPage()) return
    val p = synchronized(dropped) { requests.remove(id) ?: run { dropped.add(id); null } } ?: return
    p.done.set(true)
    synchronized(p) { (p as java.lang.Object).notifyAll() }
    pool.execute { try { p.connection.disconnect() } catch (e: Throwable) {} }
  }

  companion object {
    /** The app's own page's origin (Tauri's on Android). */
    const val ORIGIN = "http://tauri.localhost"
    /** The longest a reading holds the CPU awake: longer than an engine is waited for (speech.ts). */
    const val READING_MS = 5 * 60_000L
  }
}
