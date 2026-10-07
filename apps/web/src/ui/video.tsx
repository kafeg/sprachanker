// An episode's video (09): HD by default with a switch to SD, and the subtitle track. The lesson's
// overview shows it, and so does an exercise whose video is the episode (through `Episode`).
import { createContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { languageName } from "@/i18n/index.ts";
import { claimPlayback } from "./playback.ts";
import { useRequiredTargetLang } from "./target-lang.ts";
import { cn } from "./utils.ts";

export type EpisodeFiles = { sd?: string; hd?: string; subtitles?: string };

/** The lesson's episode, set by the player: an exercise video that is one of its files plays as it. */
export const Episode = createContext<EpisodeFiles | undefined>(undefined);

export function EpisodeVideo({
  sd,
  hd,
  subtitles,
  url,
  onHeard,
}: EpisodeFiles & {
  url(p: string): string;
  /** Called once it has been played (or cannot be). */
  onHeard?: () => void;
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const ref = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<"sd" | "hd">("hd");
  const src = quality === "hd" && hd ? hd : (sd ?? hd);
  if (!src) return null;
  const switchTo = (q: "sd" | "hd") => {
    const video = ref.current;
    const time = video?.currentTime ?? 0;
    const playing = video ? !video.paused : false;
    setQuality(q);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.currentTime = time;
      if (playing) void ref.current.play();
    });
  };
  return (
    <div className="space-y-2">
      {/* biome-ignore lint/a11y/useMediaCaption: the German track is added when the source has one */}
      <video
        ref={ref}
        key={src}
        controls
        preload="metadata"
        onPlay={(e) => {
          claimPlayback(e.currentTarget);
          onHeard?.();
        }}
        onError={onHeard}
        className="aspect-video w-full rounded-2xl bg-black"
        src={url(src)}
      >
        {subtitles && (
          <track
            kind="subtitles"
            srcLang={lang}
            label={languageName(lang)}
            src={url(subtitles)}
            default
          />
        )}
      </video>
      {hd && sd && (
        <div className="flex justify-end">
          <div className="inline-flex rounded-lg border bg-card p-0.5 text-sm">
            {(["sd", "hd"] as const).map((q) => (
              <button
                type="button"
                key={q}
                onClick={() => switchTo(q)}
                aria-pressed={quality === q}
                className={cn(
                  "rounded-md px-3 py-1 pointer-coarse:min-h-11",
                  quality === q && "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {t(`video.${q}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
