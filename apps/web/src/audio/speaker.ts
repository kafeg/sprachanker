// Reading aloud (08): one text at a time, through the device's voices (Web Speech API) — the voice
// chosen for each language in the profile, else the best one there — at the profile's reading speed.
// What starts playing (a recording, a video) stops it, and it stops what plays; which text is being
// read is shared by every speaker button, so one shows "stop" while the others show "listen".
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSetting } from "@/api/hooks.ts";
import { claimPlayback } from "@/ui/playback.tsx";
import { bestVoice, type SpokenPart, speaks, type VoiceInfo } from "./speak.ts";

/** Engines a profile can choose for reading aloud (the device's voices only, for now). */
export type ReadEngine = "device";

const synth = () => (typeof speechSynthesis === "undefined" ? undefined : speechSynthesis);

/** Chrome stops reading an utterance after about 15 s: long parts go sentence by sentence. */
const PIECE = 200;
const pieces = (text: string) =>
  text.length <= PIECE ? [text] : (text.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [text]);

let reading: string | undefined;
const listeners = new Set<() => void>();
const setReading = (id: string | undefined) => {
  reading = id;
  for (const l of listeners) l();
};
/** The read-aloud as the one thing playing: another medium starting stops it. */
const asPlaying = { pause: () => stop() };

export function stop() {
  if (reading === undefined) return;
  setReading(undefined);
  synth()?.cancel();
}

/** Reads `parts` aloud as `id` (stopping whatever is read or played); resolves when done or stopped. */
export function read(
  id: string,
  parts: SpokenPart[],
  options: { voiceFor(lang: string): SpeechSynthesisVoice | undefined; rate: number },
): Promise<void> {
  const engine = synth();
  stop();
  if (!engine || !parts.length) return Promise.resolve();
  claimPlayback(asPlaying);
  setReading(id);
  const utterances = parts.flatMap(({ text, lang }) =>
    pieces(text).map((piece) => {
      const u = new SpeechSynthesisUtterance(piece);
      const voice = options.voiceFor(lang);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice;
      u.rate = options.rate;
      return u;
    }),
  );
  return new Promise((resolve) => {
    const last = utterances.at(-1) as SpeechSynthesisUtterance;
    last.onend = last.onerror = () => {
      if (reading === id) setReading(undefined);
      resolve();
    };
    // A stop before the end ends nothing more: the promise settles with the stop.
    const unsubscribe = () => listeners.delete(onStop);
    const onStop = () => {
      if (reading !== id) {
        unsubscribe();
        resolve();
      }
    };
    listeners.add(onStop);
    for (const u of utterances) engine.speak(u);
  });
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

/** Reading aloud with the profile's voices and speed: whether it can, what is being read, read/stop. */
export function useSpeaker() {
  const voices = useDeviceVoices();
  const chosen = useSetting("speech.voices")?.device;
  const rate = useSetting("speech.readRate");
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => reading,
  );
  const say = useCallback(
    (id: string, parts: SpokenPart[]) =>
      read(id, parts, { voiceFor: (lang) => deviceVoice(voices, chosen, lang), rate }),
    [voices, chosen, rate],
  );
  return {
    /** The device reads aloud at all (no voices: nothing to read with). */
    available: !!synth() && voices.length > 0,
    /** Whether the device has a voice for a language. */
    canRead: (lang: string) => voices.some((v) => speaks(voiceInfo(v), lang)),
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
