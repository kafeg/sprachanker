// Playback shared by every medium (09): one plays at a time — whatever starts pauses the one playing —
// and the profile's speed (provided by the app through PlaybackRate) with the button that steps it.
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./utils.ts";

let playing: HTMLMediaElement | undefined;

/** Pauses whatever else plays; call when a medium starts. */
export function claimPlayback(media: HTMLMediaElement) {
  if (playing && playing !== media) playing.pause();
  playing = media;
}

/** Speeds the speed button steps through: slower helps beginners. */
export const PLAYBACK_RATES = [1, 0.75, 0.5] as const;

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
