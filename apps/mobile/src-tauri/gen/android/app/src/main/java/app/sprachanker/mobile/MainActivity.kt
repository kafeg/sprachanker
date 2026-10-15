package app.sprachanker.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The microphone asked for once: the page's recordings need it granted to the app.
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
      requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
    // The page under no system bar: the room of the bars, the camera's cutout and the keyboard left
    // as padding (Android's WebView does not give the page their sizes as safe-area insets).
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val room = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime(),
      )
      view.setPadding(room.left, room.top, room.right, room.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  // Back goes back through the app's pages (the router's history: its index in `history.state`), and
  // from the first one puts the app away as Home does.
  override fun onWebViewCreate(webView: WebView) {
    // The page's native side for the shared code: the app's files, requests to other hosts.
    getExternalFilesDir(null)
    webView.addJavascriptInterface(
      Native(this, webView, "/sdcard/Android/data/$packageName/files"),
      "sprachankerNativeBridge",
    )
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(
          "(history.state && history.state.__TSR_index > 0) ? (history.back(), 'back') : 'first'",
        ) { answer -> if (answer != "\"back\"") moveTaskToBack(true) }
      }
    })
  }
}
