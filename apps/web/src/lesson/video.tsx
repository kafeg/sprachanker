// Episode video with an HD switch and the German subtitle track (09).
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { claimPlayback } from "@/ui/media.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";

export function EpisodeVideo({
  sd,
  hd,
  subtitles,
  url,
}: {
  sd?: string;
  hd?: string;
  subtitles?: string;
  url(p: string): string;
}) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const ref = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<"sd" | "hd">("sd");
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
        onPlay={(e) => claimPlayback(e.currentTarget)}
        className="aspect-video w-full rounded-2xl bg-black"
        src={url(src)}
      >
        {subtitles && (
          <track
            kind="subtitles"
            srcLang={lang ?? "de"}
            label={new Intl.DisplayNames([lang ?? "de"], { type: "language" }).of(lang ?? "de")}
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
                  "rounded-md px-3 py-1",
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
