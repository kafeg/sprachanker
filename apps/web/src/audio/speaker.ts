// Reading aloud (08): one text at a time, each part with the profile's engine — Piper on the server
// when it has a voice for the part's language, else the device's voices (Web Speech API) — the voice
// chosen for each language in the profile, else the best one there, at the profile's reading speed.
// What starts playing (a recording, a video) stops it, and it stops what plays; which text is being
// read is shared by every speaker button, so one shows "stop" while the others show "listen".
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sayOnServer, usePiperVoices, useQwenTts, useSetting, warmQwen } from "@/api/hooks.ts";
import { claimPlayback } from "@/ui/playback.tsx";
import { asOneText, bestVoice, type SpokenPart, speaks, type VoiceInfo } from "./speak.ts";

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
export interface ReadOptions {
  /** How a language is read (undefined: it cannot be). */
  wayFor(lang: string): Way | undefined;
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

/** Reads `parts` aloud as `id` (stopping whatever is read or played); resolves when done or stopped.
 *  The server's pieces are asked for one ahead, so the next is there when one ends; a piece the server
 *  cannot say is said by the device's voice. */
export async function read(id: string, parts: SpokenPart[], options: ReadOptions): Promise<void> {
  stop();
  const queue = parts.flatMap(({ text, lang, langs }) => {
    const way = options.wayFor(lang);
    return way ? pieces(text).map((piece) => ({ text: piece, lang, langs, way })) : [];
  });
  if (!queue.length) return;
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
        ...(piece.langs && { langs: piece.langs }),
        signal: controller.signal,
      }).catch(() => undefined),
    );
  };
  try {
    for (const [i, piece] of queue.entries()) {
      if (!live()) return;
      fetchAt(i);
      fetchAt(queue.findIndex((p, j) => j > i && "server" in p.way));
      const way = piece.way;
      if ("server" in way) {
        const wav = await fetched.get(i);
        if (!live()) return;
        if (wav) await play(wav, stopped);
        else if (way.fallback) await sayOnDevice(piece.text, piece.lang, way.fallback, stopped);
      } else await sayOnDevice(piece.text, piece.lang, way, stopped);
    }
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
  const engine = useSetting("speech.readEngine");
  const chosen = useSetting("speech.voices");
  const rate = useSetting("speech.readRate");
  const piper = usePiperVoices(engine === "piper").data;
  const qwen = useQwenTts(engine === "qwen").data;
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
  const wayFor = (lang: string): Way | undefined => {
    const device = voices.some((v) => speaks(voiceInfo(v), lang))
      ? { device: deviceVoice(voices, chosen?.device, lang), rate }
      : undefined;
    return serverLangs.has(lang) ? { server: {}, fallback: device } : device;
  };
  // Qwen3-TTS reads a text mixing languages whole, with one voice: never word by word.
  const whole = (parts: SpokenPart[]) =>
    engine === "qwen" && parts.length > 1 && parts.every((p) => serverLangs.has(p.lang))
      ? asOneText(parts)
      : parts;
  const say = (id: string, parts: SpokenPart[]) => read(id, whole(parts), { wayFor });
  return {
    /** Something here reads aloud at all. */
    available: (!!synth() && voices.length > 0) || serverLangs.size > 0,
    /** Whether a language can be read (by Piper or a device voice). */
    canRead: (lang: string) => !!wayFor(lang),
    reading: current,
    say,
    stop,
  };
}

/** What a text read aloud is known by: the same parts are the same reading, wherever they are. */
export const readingId = (parts: SpokenPart[]) => parts.map((p) => `${p.lang}:${p.text}`).join("|");

/**
 * Reads an AI line aloud as it arrives, when the profile asks for it ("read aloud at once": scene
 * lines, or scene lines and the tutor's replies). `loaded`: what was there when the page opened is
 * known — that is never read; `key` names the latest line.
 */
export function useReadAtOnce(
  kind: "scene" | "tutor",
  loaded: boolean,
  key: string | undefined,
  parts: SpokenPart[],
) {
  const mode = useSetting("speech.readAtOnce");
  const { say } = useSpeaker();
  /** The latest line seen; null until the page's lines are known. */
  const seen = useRef<string | undefined | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new line is what reads, not new parts
  useEffect(() => {
    if (!loaded) return;
    if (seen.current === null || key === undefined || key === seen.current) {
      seen.current = key;
      return;
    }
    seen.current = key;
    if (mode === "all" || (mode === "scenes" && kind === "scene"))
      void say(readingId(parts), parts);
  }, [loaded, key]);
}
