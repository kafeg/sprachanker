// Media blocks: compact audio button, stimulus video/image/audio.
import type { Media } from "@sprachanker/schema";
import { Pause, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "./utils.ts";

export function AudioButton({
  src,
  label,
  className,
}: {
  src: string;
  label: string;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = () => {
    if (!audio.current) {
      audio.current = new Audio(src);
      audio.current.onended = () => setPlaying(false);
      audio.current.onpause = () => setPlaying(false);
      audio.current.onplay = () => setPlaying(true);
    }
    if (audio.current.paused) {
      audio.current.currentTime = 0;
      void audio.current.play();
    } else audio.current.pause();
  };
  return (
    <button
      type="button"
      aria-label={label}
      onClick={toggle}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full border bg-card text-foreground transition hover:bg-accent",
        playing && "border-primary bg-primary text-primary-foreground",
        className,
      )}
    >
      {playing ? <Pause className="size-5" /> : <Volume2 className="size-5" />}
    </button>
  );
}

export function MediaBlock({
  media,
  url,
  audioLabel,
}: {
  media?: Media;
  url: (path: string) => string;
  audioLabel: string;
}) {
  if (!media) return null;
  return (
    <div className="my-3 flex flex-wrap items-center gap-3">
      {media.video && (
        // biome-ignore lint/a11y/useMediaCaption: course clips come without separate captions
        <video
          controls
          preload="metadata"
          src={url(media.video)}
          className="w-full max-w-2xl rounded-xl bg-black"
        />
      )}
      {media.image && <img src={url(media.image)} alt="" className="max-h-72 w-auto rounded-xl" />}
      {media.audio && <AudioButton src={url(media.audio)} label={audioLabel} />}
    </div>
  );
}
