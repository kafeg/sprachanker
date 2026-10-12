// Playback shared by every medium: one plays at a time — whatever starts pauses the one playing —
// and the profile's speed (provided by the app through PlaybackRate) with the button that steps it.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./utils.ts";

/** What plays: a medium, or a text being read aloud (audio/speaker.ts). */
interface Playing {
  pause(): void;
}
let playing: Playing | undefined;

/** Pauses whatever else plays; call when a medium starts (or reading aloud does). */
export function claimPlayback(media: Playing) {
  if (playing && playing !== media) playing.pause();
  playing = media;
}

/** Pauses whatever plays: the learner records themselves, and the microphone would hear it. */
export function stopPlayback() {
  playing?.pause();
  playing = undefined;
}

/** Speeds the speed button steps through: slower helps beginners. */
const PLAYBACK_RATES = [1, 0.75, 0.5] as const;

export const PlaybackRate = createContext<{ rate: number; setRate(rate: number): void }>({
  rate: 1,
  setRate() {},
});

/** The profile's speed and the button that steps through `PLAYBACK_RATES`. */
export function SpeedButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { rate, setRate } = useContext(PlaybackRate);
  const next = () =>
    setRate(
      PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate as never) + 1) % PLAYBACK_RATES.length] ?? 1,
    );
  return (
    <button
      type="button"
      onClick={next}
      aria-label={t("player.speed", { rate })}
      className={cn(
        "min-h-11 min-w-11 rounded-lg px-1.5 text-sm font-semibold tabular-nums hover:bg-accent",
        rate !== 1 && "bg-accent ring-1 ring-primary",
        className,
      )}
    >
      {rate}×
    </button>
  );
}

/**
 * A short clip played from the start on demand (a word, one's take): playing or not, and whether it
 * cannot load (a file that cannot load says so). Made on first play; another `src` in the same
 * place stops the old one and lets it go. `rate`: the speed it plays at.
 */
export function useClip(src: string, rate = 1) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cleanup runs when `src` changes
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
      setPlaying(false);
      setFailed(false);
    },
    [src],
  );
  const element = () => {
    if (!audio.current) {
      const a = new Audio(src);
      a.onplay = () => {
        claimPlayback(a);
        setPlaying(true);
      };
      a.onpause = () => setPlaying(false);
      a.onended = () => setPlaying(false);
      a.onerror = () => {
        setFailed(true);
        setPlaying(false);
      };
      audio.current = a;
    }
    return audio.current;
  };
  const play = () => {
    const a = element();
    a.currentTime = 0;
    a.playbackRate = rate;
    a.play().catch((error: unknown) => {
      // The browser not letting it play by itself yet (autoplay) is no failure: a tap plays it. Nor is
      // a play cut short by a pause or another clip (AbortError).
      setPlaying(false);
      const name = (error as Error).name;
      if (name !== "NotAllowedError" && name !== "AbortError") setFailed(true);
    });
  };
  const toggle = () => {
    const a = element();
    if (a.paused) play();
    else a.pause();
  };
  return { playing, failed, play, toggle };
}
