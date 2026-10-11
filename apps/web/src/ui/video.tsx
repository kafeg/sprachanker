// An episode's video (09): HD by default with a switch to SD, the profile's speed, the subtitles on or
// off with one button, and the text of the video under it. The lesson's overview shows it when no
// exercise does; an exercise whose video is the episode shows it (through `Episode`).
import { Captions } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { languageName } from "@/i18n/index.ts";
import { CourseHtml } from "./course-html.tsx";
import { panelClass } from "./panel.tsx";
import { claimPlayback, PlaybackRate, SpeedButton } from "./playback.tsx";
import { useRequiredTargetLang } from "./target-lang.ts";
import { cn } from "./utils.ts";

type EpisodeFiles = {
  sd?: string;
  hd?: string;
  subtitles?: string;
  /** The text of the video (the lesson's script page), under it. */
  textHtml?: string;
};

const PEEK_AT = 0.5;

/** A clip that opens on a black frame is never a black box: until it is first played it shows a
 *  frame a moment in, then plays from its beginning (unless the learner moved it meanwhile). The
 *  `<video>`'s loadedmetadata, seeked and play call these. */
export const peek = {
  loaded(video: HTMLVideoElement) {
    if (video.currentTime !== 0 || !video.paused || !(video.duration > PEEK_AT * 2)) return;
    video.dataset.peek = "seeking";
    video.currentTime = PEEK_AT;
  },
  seeked(video: HTMLVideoElement) {
    if (video.dataset.peek === "seeking") video.dataset.peek = "shown";
    else delete video.dataset.peek;
  },
  // Played while the frame is shown or still being sought: from the beginning.
  play(video: HTMLVideoElement) {
    if (video.dataset.peek !== undefined) video.currentTime = 0;
    delete video.dataset.peek;
  },
  /** Where the clip really is: its beginning while the frame is shown. */
  time: (video: HTMLVideoElement) => (video.dataset.peek !== undefined ? 0 : video.currentTime),
};

/** The lesson's episode, set by the player: an exercise video that is one of its files plays as it. */
export const Episode = createContext<EpisodeFiles | undefined>(undefined);

/** One of the episode's files: the exercise shows the episode. */
export const isEpisode = (episode: EpisodeFiles | undefined, video: string | undefined) =>
  !!video && !!episode && (video === episode.sd || video === episode.hd);

export function EpisodeVideo({
  sd,
  hd,
  subtitles,
  textHtml,
  url,
  onHeard,
}: EpisodeFiles & {
  url(p: string): string;
  /** Called once it has been played (or cannot be). */
  onHeard?: () => void;
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const { rate } = useContext(PlaybackRate);
  const ref = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<"sd" | "hd">("hd");
  const [captions, setCaptions] = useState(true);
  const src = quality === "hd" && hd ? hd : (sd ?? hd);
  // The speed and the subtitles follow the controls, also after switching the quality (a new element).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `src` makes a new video element
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = rate;
    for (const track of Array.from(video.textTracks)) track.mode = captions ? "showing" : "hidden";
  }, [rate, captions, src]);
  if (!src) return null;
  const switchTo = (q: "sd" | "hd") => {
    const video = ref.current;
    const time = video ? peek.time(video) : 0;
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
      {/* biome-ignore lint/a11y/useMediaCaption: the subtitle track is added when the source has one */}
      <video
        ref={ref}
        key={src}
        controls
        preload="metadata"
        onPlay={(e) => {
          peek.play(e.currentTarget);
          claimPlayback(e.currentTarget);
          onHeard?.();
        }}
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = rate;
          peek.loaded(e.currentTarget);
        }}
        onSeeked={(e) => peek.seeked(e.currentTarget)}
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
            default={captions}
          />
        )}
      </video>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {subtitles && (
          <button
            type="button"
            aria-pressed={captions}
            onClick={() => setCaptions((on) => !on)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm pointer-coarse:min-h-11",
              captions && "bg-primary font-semibold text-primary-foreground",
            )}
          >
            <Captions className="size-4" aria-hidden />
            {t("video.subtitles")}
          </button>
        )}
        <SpeedButton className="min-h-9 border bg-card pointer-coarse:min-h-11" />
        {hd && sd && (
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
        )}
      </div>
      {textHtml && (
        <details className={cn(panelClass, "px-5 py-3")}>
          <summary className="cursor-pointer font-semibold pointer-coarse:min-h-11 pointer-coarse:content-center">
            {t("lesson.videoText")}
          </summary>
          <CourseHtml className="mt-3" html={textHtml} />
        </details>
      )}
    </div>
  );
}
