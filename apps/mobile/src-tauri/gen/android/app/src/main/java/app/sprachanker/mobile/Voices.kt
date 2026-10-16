package app.sprachanker.mobile

import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

// The device's voices for the page (`sprachankerVoices`): Android's TextToSpeech, which the WebView
// does not give the page as `speechSynthesis` — apps/mobile/src/voices.ts makes that of it. The voices
// on the device (none that needs the network: what is read stays on the phone), a text said in a
// language with a voice and speed, its start and end told; stopped. Answers go through
// `window.sprachankerNative.done(id, …)`, as Native.kt's do; the app's own page alone is answered
// (Native.kt's `guard`).
class Voices(activity: ComponentActivity, private val webView: WebView, private val guard: () -> Unit) {
  private val listeners = mutableListOf<Int>()
  @Volatile private var ready: Boolean? = null
  private val tts: TextToSpeech = TextToSpeech(activity) { status ->
    synchronized(this) {
      ready = status == TextToSpeech.SUCCESS
      for (id in listeners) answer(id, voicesJson())
      listeners.clear()
    }
  }

  init {
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String) = told(utteranceId, "start")
      override fun onDone(utteranceId: String) = told(utteranceId, "end")
      @Deprecated("the error code's variant is the one called on newer systems")
      override fun onError(utteranceId: String) = told(utteranceId, "error")
      override fun onError(utteranceId: String, errorCode: Int) = told(utteranceId, "error")
      override fun onStop(utteranceId: String, interrupted: Boolean) = told(utteranceId, "end")
    })
    activity.lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onDestroy(owner: LifecycleOwner) {
        tts.shutdown()
      }
    })
  }

  private fun answer(id: Int, json: String) {
    webView.post { webView.evaluateJavascript("window.sprachankerNative&&window.sprachankerNative.done($id,$json)", null) }
  }

  private fun told(utteranceId: String, what: String) {
    utteranceId.toIntOrNull()?.let { answer(it, JSONObject.quote(what)) }
  }

  /** The voices installed on the device, the best first (quality, then the language's default). */
  private fun installed(): List<Voice> =
    (try { tts.voices } catch (e: Exception) { null } ?: emptySet())
      .filter { !it.isNetworkConnectionRequired && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
      .sortedWith(compareByDescending<Voice> { it.quality }.thenBy { it.name })

  private fun voicesJson(): String {
    val out = JSONArray()
    if (ready != true) return out.toString()
    val default = try { tts.defaultVoice?.name } catch (e: Exception) { null }
    for (v in installed())
      out.put(JSONObject()
        .put("name", v.name)
        .put("lang", v.locale.toLanguageTag())
        .put("quality", v.quality)
        .put("default", v.name == default))
    return out.toString()
  }

  /** The voices, once the engine has started: answered to `id` (a JSON array). */
  @JavascriptInterface fun voices(id: Int) {
    guard()
    synchronized(this) {
      if (ready == null) listeners.add(id) else answer(id, voicesJson())
    }
  }

  /** Says `text` (a language tag; a voice by its name, or none: the language's best installed) at
   *  `rate` (1: as the voice speaks), after what is being said; its start and end told to `id`. Only
   *  with a voice on the device: a language set without one is read by the engine's server (Google's
   *  sends the text away), so a language without one is not read. */
  @JavascriptInterface fun speak(id: Int, text: String, lang: String, voice: String, rate: Float) {
    guard()
    if (ready != true) return answer(id, JSONObject.quote("error"))
    val all = installed()
    val wanted = Locale.forLanguageTag(lang)
    val chosen = all.find { it.name == voice }
      ?: all.find { it.locale == wanted }
      ?: all.find { it.locale.language == wanted.language && (wanted.country.isEmpty() || it.locale.country == wanted.country) }
      ?: all.find { it.locale.language == wanted.language }
      ?: return answer(id, JSONObject.quote("error"))
    tts.voice = chosen
    tts.setSpeechRate(rate)
    tts.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), id.toString())
  }

  /** Stops what is said and what waits to be. */
  @JavascriptInterface fun stop() {
    guard()
    tts.stop()
  }
}
