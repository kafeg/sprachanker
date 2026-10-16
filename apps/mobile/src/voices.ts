// The device's voices on Android as the page's `speechSynthesis` (Voices.kt: the WebView gives the
// page none), so the web app's "device's voices" read on the phone as in a browser: the voices listed
// — `voiceschanged` once Android's engine has started —, an utterance said in its language with its
// voice and rate after what is being said, its start and end told; all stopped by `cancel`.
import { later } from "./bridge.ts";

/** The native side's voices (Voices.kt, `sprachankerVoices`). */
export interface VoicesBridge {
  voices(id: number): void;
  speak(id: number, text: string, lang: string, voice: string, rate: number): void;
  stop(): void;
}

interface AndroidVoice {
  name: string;
  lang: string;
  quality: number;
  default: boolean;
}

/** "de-de-x-deb-local" of German (Germany) → "deb · de-DE": a voice's name without its language
 *  ("de-DE-language" → "de-DE"). */
export function voiceLabel(name: string, lang: string) {
  let rest = name;
  if (rest.toLowerCase().startsWith(`${lang.toLowerCase()}-`)) rest = rest.slice(lang.length + 1);
  rest = rest.replace(/^x-/, "").replace(/-local$/, "");
  // The language's own voice ("de-DE-language"): its language alone.
  if (rest === "language") return lang;
  return `${rest || name} · ${lang}`;
}

export class PhoneUtterance extends EventTarget {
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: ((e: Event) => void) | null = null;
  onend: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(public text = "") {
    super();
  }
  /** Tells what happened to it, as a browser does (its handler, its listeners). */
  tell(type: "start" | "end" | "error") {
    const event = Object.assign(new Event(type), { utterance: this });
    (type === "start" ? this.onstart : type === "end" ? this.onend : this.onerror)?.(event);
    this.dispatchEvent(event);
  }
}

export class PhoneSynthesis extends EventTarget {
  onvoiceschanged: ((e: Event) => void) | null = null;
  paused = false;
  #voices: SpeechSynthesisVoice[] = [];
  /** The utterances given to the native side and not ended, by id. */
  #out = new Map<number, { u: PhoneUtterance; forget(): void }>();

  constructor(private readonly native: VoicesBridge) {
    super();
    this.#ask();
    // Voices installed in Android's settings meanwhile: asked again when the app is back.
    globalThis.document?.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.#ask();
    });
  }

  /** The voices asked of the native side; `voiceschanged` when they are not those known. */
  #ask() {
    const call = later((answer) => {
      call.forget();
      const list = [...(answer as AndroidVoice[])].sort(
        (a, b) => Number(b.default) - Number(a.default) || b.quality - a.quality,
      );
      const voices = list.map((v) => ({
        name: voiceLabel(v.name, v.lang),
        lang: v.lang,
        voiceURI: v.name,
        localService: true,
        default: v.default,
      }));
      const ids = (vs: SpeechSynthesisVoice[]) => vs.map((v) => v.voiceURI).join("\n");
      if (ids(voices) === ids(this.#voices) && this.#voices.length) return;
      this.#voices = voices;
      const event = new Event("voiceschanged");
      this.onvoiceschanged?.(event);
      this.dispatchEvent(event);
    });
    this.native.voices(call.id);
  }

  get speaking() {
    return this.#out.size > 0;
  }
  get pending() {
    return this.#out.size > 1;
  }
  getVoices() {
    return [...this.#voices];
  }

  speak(u: SpeechSynthesisUtterance) {
    const utterance = u as unknown as PhoneUtterance;
    const call = later((answer) => {
      const what = answer as "start" | "end" | "error";
      if (what !== "start") {
        call.forget();
        this.#out.delete(call.id);
      }
      utterance.tell(what);
    });
    this.#out.set(call.id, { u: utterance, forget: call.forget });
    const voice = utterance.voice;
    try {
      this.native.speak(
        call.id,
        utterance.text,
        voice?.lang || utterance.lang || "en",
        voice?.voiceURI ?? "",
        utterance.rate,
      );
    } catch {
      // Refused (not the app's page): said as an error, as a browser's would be.
      call.forget();
      this.#out.delete(call.id);
      utterance.tell("error");
    }
  }

  /** Stops what is said and what waits: each ends now (what the native side tells later is not). */
  cancel() {
    this.native.stop();
    const out = [...this.#out.values()];
    this.#out.clear();
    for (const { u, forget } of out) {
      forget();
      u.tell("end");
    }
  }
  pause() {}
  resume() {}
}

/** The page's `speechSynthesis` over the native side's voices, where it has them (Android). */
export function installVoices() {
  const native = (globalThis as { sprachankerVoices?: VoicesBridge }).sprachankerVoices;
  if (!native) return;
  Object.defineProperty(globalThis, "speechSynthesis", {
    value: new PhoneSynthesis(native),
    configurable: true,
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    value: PhoneUtterance,
    configurable: true,
    writable: true,
  });
}
