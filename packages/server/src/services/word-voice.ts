// The voice words are read with (owner, 2026-10-15): for each language a recording of a course in
// it — one native speaker's sentence, its exact text in the course data — cloned by Qwen3-TTS's Base
// model (qwen-tts.ts). The server proposes the recordings (sentences of 50–160 letters first, the
// shorter first); the page decodes the one chosen to 24 kHz WAV and sends it; it is kept for every
// profile in <data-root>/models/word-voices, never with the course's files. A deck's words, Finds
// and words selected are read with it where it is there (profile-speech.ts).
import type { LibraryView } from "@sprachanker/course-kit/view";
import { type LessonKey, parseEditionId } from "@sprachanker/schema";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import { sha256Hex } from "../security/encoding.ts";
import type { Content } from "./content.ts";
import type { DeckReader } from "./deck-audio.ts";
import type { VoiceStore } from "./local-engines.ts";
import type { ClonedVoice, QwenTts } from "./qwen-tts.ts";

/** A course's recording a voice can be taken from: where it is and what it says. */
export interface Candidate {
  series: string;
  path: string;
  text: string;
}

/** What is kept of a voice beside its recording. */
const About = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  series: z.string(),
  path: z.string(),
});
type About = z.infer<typeof About>;

/** Exercises whose item's text is what its recording says: the sentence to say after it. */
const SAID = new Set(["speech_selfrate", "speech_repeat"]);
/** A sentence of this many letters is read in about 5 to 12 s: enough of a voice to clone. */
const BAND = { min: 50, max: 160 };
/** Recordings proposed once this many are in the band (enough to choose from: the rest of a big
 *  series is not read). */
const ENOUGH = 20;
/** The recording sent: 24 kHz mono 16-bit, 1 to 30 s. */
const RATE = 24_000;
const MIN_S = 1;
const MAX_S = 30;
export const VOICE_MAX_BYTES = 44 + RATE * 2 * MAX_S;

/** A text that is one sentence or two of words a voice says as written: no gap, no list. */
const sayable = (text: string) =>
  text.length <= 200 &&
  text.trim().split(/\s+/).length >= 2 &&
  !/[\n…_]|\s[–—-]\s/.test(text) &&
  /\p{L}/u.test(text);

/** The candidates in order: sentences in the band first, the shorter first; then shorter ones, the
 *  longer first. */
const order = (all: Candidate[]) => {
  const inBand = (c: Candidate) => c.text.length >= BAND.min && c.text.length <= BAND.max;
  return [
    ...all.filter(inBand).sort((a, b) => a.text.length - b.text.length),
    ...all
      .filter((c) => !inBand(c) && c.text.length < BAND.min)
      .sort((a, b) => b.text.length - a.text.length),
  ];
};

/** Whether `wav` is what the engine is given: a PCM WAV of 24 kHz, mono, 16-bit, 1–30 s long. */
function isVoiceWav(wav: Uint8Array) {
  if (wav.length < 44) return false;
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt ") return false;
  const pcm = v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1;
  const format = v.getUint32(24, true) === RATE && v.getUint16(34, true) === 16;
  const seconds = (wav.length - 44) / (RATE * 2);
  return pcm && format && tag(36) === "data" && seconds >= MIN_S && seconds <= MAX_S;
}

export function createWordVoice(deps: {
  content: Pick<Content, "courses">;
  library: Pick<LibraryView, "lesson" | "courseStamp">;
  qwen: QwenTts;
  store?: VoiceStore;
}) {
  const { qwen, store } = deps;
  /** Candidates by language, while the courses they were read from stay as they were. */
  const proposed = new Map<string, { stamp: string; list: Promise<Candidate[]> }>();
  /** Each language's voice as read from the store (undefined: none). */
  const voices = new Map<string, (ClonedVoice & About) | undefined>();
  /** Each language's voice being taken: one at a time. */
  const taking = new Map<string, Promise<unknown>>();

  /** The courses teaching `lang`, and a stamp of them all (one changed: read again). */
  async function coursesOf(lang: string) {
    const courses = (await deps.content.courses()).filter(
      (c) =>
        c.kind === "course" &&
        c.editions.some(
          (e) => parseEditionId(e as Parameters<typeof parseEditionId>[0]).target === lang,
        ),
    );
    const stamp = courses
      .map((c) => `${c.series}/${c.course}:${deps.library.courseStamp(c.series, c.course)}`)
      .join("|");
    return { courses, stamp };
  }

  async function read(courses: Awaited<ReturnType<typeof coursesOf>>["courses"]) {
    const found = new Map<string, Candidate>();
    let inBand = 0;
    for (const c of courses)
      for (const key of c.lessons) {
        if (inBand >= ENOUGH) return order([...found.values()]);
        const lesson = await deps.library.lesson(c.series, key as LessonKey).catch(() => undefined);
        for (const { exercise } of lesson?.pages ?? []) {
          if (!SAID.has(exercise.type)) continue;
          for (const item of exercise.items as Array<{
            text?: unknown;
            media?: { audio?: string };
          }>) {
            const path = item.media?.audio;
            const text = typeof item.text === "string" ? item.text.trim() : "";
            const id = `${c.series}/${path}`;
            if (!path || !sayable(text) || found.has(id)) continue;
            found.set(id, { series: c.series, path, text });
            if (text.length >= BAND.min && text.length <= BAND.max) inBand++;
          }
        }
      }
    return order([...found.values()]);
  }

  /** The recordings of the courses here in `lang` a voice can be taken from, in order. */
  async function candidates(lang: string): Promise<Candidate[]> {
    const { courses, stamp } = await coursesOf(lang);
    const known = proposed.get(lang);
    if (known?.stamp === stamp) return known.list;
    const list = read(courses);
    proposed.set(lang, { stamp, list });
    list.catch(() => proposed.delete(lang));
    return list;
  }

  /** The language's voice, when one was taken. */
  function voiceOf(lang: string) {
    if (!voices.has(lang)) {
      const kept = store?.get(lang);
      const about = About.safeParse(kept?.about);
      voices.set(lang, kept && about.success ? { ...about.data, wav: kept.wav } : undefined);
    }
    return voices.get(lang);
  }

  /** A recording taken as `lang`'s voice (`choose`, one at a time). */
  async function take(lang: string, recording: { series: string; path: string }, wav: Uint8Array) {
    if (!store) throw new ServiceError("speech_unavailable", 409);
    const chosen = (await candidates(lang)).find(
      (c) => c.series === recording.series && c.path === recording.path,
    );
    if (!chosen) throw new ServiceError("no_such_recording", 404);
    if (!wav.length) throw new ServiceError("empty_recording");
    if (!isVoiceWav(wav)) throw new ServiceError("unsupported_audio");
    const text = new TextEncoder().encode(chosen.text);
    const bytes = new Uint8Array(wav.length + text.length);
    bytes.set(wav);
    bytes.set(text, wav.length);
    const about: About = { id: await sha256Hex(bytes, 12), ...chosen };
    store.put(lang, { id: about.id, wav, about });
    voices.delete(lang);
    return about;
  }

  return {
    candidates,

    /** The voice of each language taken (from the courses' recordings), as Settings shows it. */
    state(langs: readonly string[]): Record<string, About> {
      const out: Record<string, About> = {};
      for (const lang of langs) {
        const v = voiceOf(lang);
        if (v) out[lang] = { id: v.id, text: v.text, series: v.series, path: v.path };
      }
      return out;
    },

    /** Takes a course's recording (one of the candidates, its text from the course) as the voice of
     *  `lang`, sent as a 24 kHz mono WAV; the words read with the voice before are read again. */
    choose(lang: string, recording: { series: string; path: string }, wav: Uint8Array) {
      const next = (taking.get(lang) ?? Promise.resolve())
        .catch(() => {})
        .then(() => take(lang, recording, wav));
      taking.set(lang, next);
      return next;
    },

    /** The Base model reading `lang` in its voice — a deck's words, Finds —, when both are there;
     *  the voice's id names its readings, so words read with another voice are read again. Never
     *  kept in the readings' cache: what reads them keeps them. */
    reader(lang: string): DeckReader | undefined {
      const voice = voiceOf(lang);
      if (!voice || !qwen.canClone(lang)) return undefined;
      return {
        engine: "qwen",
        voice: `clone/${voice.id}`,
        sole: true,
        read: (text) => qwen.sayCloned(text, lang, voice, { keep: false }),
      };
    },

    /** A text read in `lang`'s voice (kept in the readings' cache); none without one. */
    say(text: string, lang: string, signal?: AbortSignal) {
      const voice = voiceOf(lang);
      if (!voice || !qwen.canClone(lang)) return undefined;
      return qwen.sayCloned(text, lang, voice, { signal });
    },

    /** Starts the Base model ahead of reading words in `lang`, when it reads them. */
    warm(lang: string) {
      if (voiceOf(lang) && qwen.canClone(lang)) qwen.warmWords();
    },
  };
}
export type WordVoice = ReturnType<typeof createWordVoice>;
