// A profile's speech (08): the server's engines — recognition, Piper, Qwen3-TTS — with the profile's
// choices in its settings: recognition on or off and its model, the engine reading aloud, its voices,
// speed and Qwen3-TTS's model — also the engine and voice a deck's words are read with.
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
    /** What was said in a 16 kHz mono WAV, in a language given, with the profile's model; `expected`:
     *  the lines to say, for telling a line said from a phrase made up of silence (never heard with). */
    async transcribe(wav: Uint8Array<ArrayBuffer>, lang: string, expected?: string[]) {
      const model = recogniser();
      if (!model) throw new ServiceError("speech_unavailable", 409);
      if (!wav.length) throw new ServiceError("empty_recording");
      return speech.take(wav, lang, model, expected);
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
     *  Piper — with the voice chosen for its one language (or `voice`, to hear one: Settings'
     *  "Listen") and speed. */
    say(input: { text: string; lang: string; voice?: string }) {
      const { text, lang } = input;
      const engine = settings.value("speech.readEngine") === "qwen" ? "qwen" : "piper";
      const chosen = input.voice ?? settings.value("speech.voices")?.[engine]?.[lang];
      if (engine === "piper")
        return readAloud.say(text, lang, chosen, settings.value("speech.readRate"));
      return qwenTts.say(text, lang, chosen, qwenModel());
    },

    /** The engine on this computer that reads a deck's words in `lang`, with its voice: the profile's
     *  (Piper or Qwen3-TTS) when it reads the language, else Piper with a voice for it, else
     *  Qwen3-TTS; none when neither can. Read at the speed recorded (the audio is every profile's) and
     *  kept in the deck's folder alone, never in the readings' cache. */
    deckReader(lang: string) {
      const own = settings.value("speech.voices");
      const engines =
        settings.value("speech.readEngine") === "qwen"
          ? (["qwen", "piper"] as const)
          : (["piper", "qwen"] as const);
      for (const engine of engines) {
        if (engine === "piper") {
          const voice = readAloud.voice(lang, own?.piper?.[lang]);
          if (voice)
            return {
              engine,
              voice,
              read: (text: string) => readAloud.say(text, lang, voice, 1, false),
            };
        } else {
          const voice = qwenTts.voice(lang, own?.qwen?.[lang], qwenModel());
          if (voice)
            return {
              engine,
              voice: `${voice.model}/${voice.speaker}`,
              read: (text: string) =>
                qwenTts.say(text, lang, voice.speaker, voice.model, { keep: false }),
            };
        }
      }
      return undefined;
    },
  };
}
