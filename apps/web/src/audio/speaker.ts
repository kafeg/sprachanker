// Reading aloud (08): one text at a time, each part with the profile's engine — Piper on the server
// when it has a voice for the part's language, else the device's voices (Web Speech API) — the voice
// chosen for each language in the profile, else the best one there, at the profile's reading speed; a
// part marked `alt` (a dialogue's second speaker) by another voice of its language where there is one.
// What starts playing (a recording, a video) stops it, and it stops what plays; which text is being
// read is shared by every speaker button, so one shows "stop" while the others show "listen".
import { useEffect, useState, useSyncExternalStore } from "react";
import { useSetting, useSettings } from "@/api/settings.ts";
import { sayOnServer, usePiperVoices, useQwenTts, warmQwen } from "@/api/speech.ts";
import { claimPlayback } from "@/ui/playback.tsx";
import { bestVoice, type SpokenPart, speaks, type VoiceInfo } from "./speak.ts";
import { voiceName } from "./voice-names.ts";

const synth = () => (typeof speechSynthesis === "undefined" ? undefined : speechSynthesis);

/** Long parts go sentence by sentence: Chrome stops an utterance after about 15 s, and the server's
 *  voice starts sooner on a short piece. */
const PIECE = 200;
const pieces = (text: string) =>
  text.length <= PIECE ? [text] : (text.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [text]);

/** How a piece is read: with a device voice (none: the browser's for its language), or by the server. */
type Device = { device: SpeechSynthesisVoice | undefined; rate: number };
/** By the server (a Piper voice); `fallback`: the device's way, when the server cannot say it. */
type Way = Device | { server: { voice?: string }; fallback?: Device };
interface ReadOptions {
  /** How a language is read, by its voice or (`alt`) another one (undefined: it cannot be). */
  wayFor(lang: string, alt?: boolean): Way | undefined;
}

/** What is being read, for the buttons; and the run reading it — a new run, even of the same text,
 *  is another one, so a stopped run never goes on. */
/** Qwen3-TTS is warmed again only after this long (it stays loaded for ten minutes). */
const WARM_AGAIN_MS = 5 * 60_000;
let qwenWarmedAt = 0;

let reading: string | undefined;
let run: { cancel(): void } | undefined;
const listeners = new Set<() => void>();
const setReading = (id: string | undefined) => {
  reading = id;
  for (const l of listeners) l();
};
/** The read-aloud as the one thing playing: another medium starting stops it. */
const asPlaying = { pause: () => stop() };

export function stop() {
  run?.cancel();
  run = undefined;
  if (reading !== undefined) setReading(undefined);
}

/** Says a piece with a device voice; resolves when it is said or the run is stopped. */
function sayOnDevice(text: string, lang: string, way: Device, stopped: Promise<void>) {
  const engine = synth();
  if (!engine) return Promise.resolve();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = way.device?.lang ?? lang;
  if (way.device) u.voice = way.device;
  u.rate = way.rate;
  return Promise.race([
    new Promise<void>((resolve) => {
      u.onend = u.onerror = () => resolve();
      engine.speak(u);
    }),
    stopped,
  ]);
}

/** Plays a WAV to its end, or until stopped. */
function play(wav: Blob, stopped: Promise<void>) {
  const url = URL.createObjectURL(wav);
  const audio = new Audio(url);
  return Promise.race([
    new Promise<void>((resolve) => {
      audio.onended = audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    }),
    stopped.then(() => audio.pause()),
  ]).finally(() => URL.revokeObjectURL(url));
}

/** Reads `parts` aloud as `id` (stopping whatever is read or played); resolves when done (true) or
 *  stopped (false). The server's pieces are asked for one ahead, so the next is there when one ends; a
 *  piece the server cannot say is said by the device's voice. */
export async function read(
  id: string,
  parts: SpokenPart[],
  options: ReadOptions,
): Promise<boolean> {
  stop();
  const queue = parts.flatMap(({ text, lang, alt }) => {
    const way = options.wayFor(lang, alt);
    return way ? pieces(text).map((piece) => ({ text: piece, lang, way })) : [];
  });
  if (!queue.length) return false;
  const controller = new AbortController();
  let stopNow = () => {};
  const stopped = new Promise<void>((resolve) => {
    stopNow = resolve;
  });
  const mine = {
    cancel() {
      controller.abort();
      synth()?.cancel();
      stopNow();
    },
  };
  run = mine;
  const live = () => run === mine;
  claimPlayback(asPlaying);
  setReading(id);
  const fetched = new Map<number, Promise<Blob | undefined>>();
  const fetchAt = (i: number) => {
    const piece = queue[i];
    if (!piece || !("server" in piece.way) || fetched.has(i)) return;
    fetched.set(
      i,
      sayOnServer(piece.text, piece.lang, {
        ...piece.way.server,
        signal: controller.signal,
      }).catch(() => undefined),
    );
  };
  try {
    for (const [i, piece] of queue.entries()) {
      if (!live()) return false;
      fetchAt(i);
      fetchAt(queue.findIndex((p, j) => j > i && "server" in p.way));
      const way = piece.way;
      if ("server" in way) {
        const wav = await fetched.get(i);
        if (!live()) return false;
        if (wav) await play(wav, stopped);
        else if (way.fallback) await sayOnDevice(piece.text, piece.lang, way.fallback, stopped);
      } else await sayOnDevice(piece.text, piece.lang, way, stopped);
    }
    return live();
  } finally {
    if (live()) {
      run = undefined;
      setReading(undefined);
    }
  }
}

/** The device's voices, as they load (Safari and Chrome give them after a while). */
export function useDeviceVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState(() => synth()?.getVoices() ?? []);
  useEffect(() => {
    const engine = synth();
    if (!engine) return;
    const update = () => setVoices(engine.getVoices());
    update();
    engine.addEventListener("voiceschanged", update);
    return () => engine.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

/** A device voice as choosing one sees it. */
export const voiceInfo = (
  v: SpeechSynthesisVoice,
): VoiceInfo & { voice: SpeechSynthesisVoice } => ({
  id: v.voiceURI,
  name: v.name,
  lang: v.lang,
  local: v.localService,
  voice: v,
});

/** Who reads a language aloud (09: named where a line is listened to, as the model is). */
export interface ReadBy {
  engine: "device" | "piper" | "qwen";
  /** The voice's name; empty when the browser picks the device's voice itself. */
  voice: string;
}

/** Another voice of the language than `main`, the best of the others (a dialogue's second speaker);
 *  undefined when there is none. */
export function otherVoice(
  voices: SpeechSynthesisVoice[],
  main: SpeechSynthesisVoice | undefined,
  lang: string,
): SpeechSynthesisVoice | undefined {
  return bestVoice(voices.filter((v) => v !== main).map(voiceInfo), lang)?.voice;
}

/** The voice that reads `lang`: the profile's choice while this device has it, else the best one. */
export function deviceVoice(
  voices: SpeechSynthesisVoice[],
  chosen: Record<string, string> | undefined,
  lang: string,
): SpeechSynthesisVoice | undefined {
  const own = chosen?.[lang];
  const mine = own && voices.find((v) => v.voiceURI === own && speaks(voiceInfo(v), lang));
  return mine || bestVoice(voices.map(voiceInfo), lang)?.voice;
}

/** Reading aloud with the profile's engine, voices and speed: whether it can, what is being read,
 *  read/stop. */
export function useSpeaker() {
  const voices = useDeviceVoices();
  const settings = useSettings();
  const engine = useSetting("speech.readEngine");
  const chosen = useSetting("speech.voices");
  const rate = useSetting("speech.readRate");
  const piperQuery = usePiperVoices(engine === "piper");
  const qwenQuery = useQwenTts(engine === "qwen");
  const piper = piperQuery.data;
  const qwen = qwenQuery.data;
  // Qwen3-TTS takes seconds to load: started as soon as something here may read with it.
  useEffect(() => {
    if (engine === "qwen" && Date.now() - qwenWarmedAt > WARM_AGAIN_MS) {
      qwenWarmedAt = Date.now();
      void warmQwen();
    }
  }, [engine]);
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => reading,
  );
  /** Languages the server reads here: Piper's with a voice downloaded, or Qwen3-TTS's while a model of
   *  it is there. */
  const serverLangs = new Set(
    engine === "piper" && piper?.engine
      ? piper.voices.filter((v) => v.installed).map((v) => v.lang)
      : engine === "qwen" && qwen?.engine && qwen.models.some((m) => m.installed)
        ? qwen.languages
        : [],
  );
  /** The server's voice of a language: the profile's while it is there, else Piper's best or
   *  Qwen3-TTS's default speaker; `alt`: another of the language when there is one. */
  const serverVoice = (lang: string, alt = false): string | undefined => {
    if (engine === "piper" && piper) {
      const own = chosen?.piper?.[lang];
      const here = piper.voices.filter((v) => v.installed && v.lang === lang).map((v) => v.id);
      const main = own && here.includes(own) ? own : piper.auto[lang];
      return alt ? (here.find((id) => id !== main) ?? main) : main;
    }
    if (engine === "qwen" && qwen) {
      const own = chosen?.qwen?.[lang];
      const speakers: readonly string[] = qwen.speakers;
      const main = own && speakers.includes(own) ? own : qwen.defaultSpeaker;
      return alt ? (speakers.find((s) => s !== main) ?? main) : main;
    }
    return undefined;
  };
  const wayFor = (lang: string, alt = false): Way | undefined => {
    const main = deviceVoice(voices, chosen?.device, lang);
    const device = voices.some((v) => speaks(voiceInfo(v), lang))
      ? { device: (alt && otherVoice(voices, main, lang)) || main, rate }
      : undefined;
    if (!serverLangs.has(lang)) return device;
    // The profile's own voice is the server's to pick; another one is named.
    const voice = alt ? serverVoice(lang, true) : undefined;
    return {
      server: voice && voice !== serverVoice(lang) ? { voice } : {},
      fallback: device,
    };
  };
  const say = (id: string, parts: SpokenPart[]) => read(id, parts, { wayFor });
  /** Who reads a language — by its voice, or (`alt`) the other one a dialogue's second speaker has:
   *  the engine and the voice as Settings → Speech names it (the device's voice unnamed when the
   *  browser picks it); undefined when nothing here reads it. */
  const readBy = (lang: string, alt = false): ReadBy | undefined => {
    const way = wayFor(lang, alt);
    if (!way) return undefined;
    if ("server" in way && (engine === "piper" || engine === "qwen")) {
      const id = serverVoice(lang, alt);
      return { engine, voice: id ? voiceName(engine, id) : "" };
    }
    const device = "server" in way ? way.fallback : way;
    return { engine: "device", voice: device?.device?.name ?? "" };
  };
  return {
    /** Something here reads aloud at all. */
    available: (!!synth() && voices.length > 0) || serverLangs.size > 0,
    /** Whether a language can be read (by Piper or a device voice). */
    canRead: (lang: string) => !!wayFor(lang),
    readBy,
    /** The profile's engine, or what the server's reads, still being asked: who reads is not known
     *  yet. */
    asking:
      settings.isPending ||
      (engine === "piper" && piperQuery.isPending) ||
      (engine === "qwen" && qwenQuery.isPending),
    reading: current,
    say,
    stop,
  };
}

/** What a text read aloud is known by: the same parts are the same reading, wherever they are. */
export const readingId = (parts: SpokenPart[]) => parts.map((p) => `${p.lang}:${p.text}`).join("|");
