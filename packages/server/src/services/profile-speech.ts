// A profile's speech (08): the server's engines — recognition, Piper, Qwen3-TTS — with the profile's
// choices in its settings: recognition on or off and its model, the engine reading aloud, its voices,
// speed and Qwen3-TTS's model.
import { ALL_LANGS } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { QwenTts } from "./qwen-tts.ts";
import type { ReadAloud } from "./read-aloud.ts";
import type { Settings } from "./settings.ts";
import type { Speech } from "./speech.ts";

/** The library's media files, for the course recordings the recogniser hears. */
interface CourseMedia {
  file(series: string, path: string): string | undefined;
  blob(file: string): Blob;
}

export function createProfileSpeech(deps: {
  speech: Speech;
  readAloud: ReadAloud;
  qwenTts: QwenTts;
  settings: Settings;
}) {
  const { speech, readAloud, qwenTts, settings } = deps;
  /** The model the profile hears with: its choice while recognition is on and the model is
   *  installed. */
  const recogniser = () =>
    settings.value("speech.recognition")
      ? speech.modelFor(settings.get("speech.model"))
      : undefined;
  /** The Qwen3-TTS model the profile chose (none: the large one when it is there). */
  const qwenModel = () => settings.get("speech.qwenModel");

  return {
    /** The server's engines, shared by the profiles: their models and voices (download, remove). */
    engines: { whisper: speech, piper: readAloud, qwen: qwenTts },
    /** Recognition: the engine and its models, and whether the profile hears with one (which). */
    state() {
      const model = recogniser();
      const state = speech.state();
      return { ...state, recognition: state.engine && !!model, model: model ?? null };
    },
    /** Starts the recogniser ahead of a recording, when the profile hears with one. */
    warm() {
      const model = recogniser();
      if (model) speech.warm(model);
    },
    /** What was said in a 16 kHz mono WAV, in a language given, with the profile's model. */
    async transcribe(wav: Uint8Array<ArrayBuffer>, lang: string) {
      const model = recogniser();
      if (!model) throw new ServiceError("speech_unavailable", 409);
      if (!wav.length) throw new ServiceError("empty_recording");
      return speech.transcribe(new Blob([wav], { type: "audio/wav" }), lang, model);
    },
    /** What a course recording says, heard with the profile's recogniser; undefined without one,
     *  or when hearing fails (what asks goes on without it). */
    hearing(media: CourseMedia) {
      return async (series: string, path: string, lang: string) => {
        const model = recogniser();
        const file = model && media.file(series, path);
        if (!model || !file) return undefined;
        return speech
          .heard(`${series}/${path}`, () => media.blob(file), lang, model)
          .catch(() => undefined);
      };
    },

    /** Qwen3-TTS's state with the profile's model marked. */
    qwen: () => qwenTts.state(qwenModel()),
    /** Starts Qwen3-TTS ahead of reading with the profile's model. */
    warmQwen: () => qwenTts.warm(qwenModel()),

    /** A WAV of a text read by the profile's engine on this computer — Qwen3-TTS when chosen, else
     *  Piper — with its voice (or `voice`, to hear one: Settings' "Listen") and speed. `langs`: the
     *  languages the text mixes (a reply quoting German), read whole where the engine can. */
    say(input: { text: string; lang: string; langs?: string[]; voice?: string }) {
      const { text, lang } = input;
      const engine = settings.value("speech.readEngine") === "qwen" ? "qwen" : "piper";
      const own = settings.value("speech.voices")?.[engine];
      // Qwen3-TTS reads every language with one voice (its speakers speak them all).
      const chosen = input.voice ?? own?.[engine === "qwen" ? ALL_LANGS : lang];
      if (engine === "piper")
        return readAloud.say(text, lang, chosen, settings.value("speech.readRate"));
      const mixed = new Set([lang, ...(input.langs ?? [])]).size > 1;
      return qwenTts.say(text, lang, chosen, qwenModel(), mixed);
    },
  };
}
