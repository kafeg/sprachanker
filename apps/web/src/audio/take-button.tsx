// One's own recording played back (08): a pill with its length; one medium plays at a time.
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { claimPlayback } from "@/ui/playback.tsx";
import { cn } from "@/ui/utils.ts";

export function TakeButton({
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
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new take lets the old one go
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
      setPlaying(false);
      setFailed(false);
    },
    [src],
  );
  const toggle = () => {
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
    const a = audio.current;
    if (playing) a.pause();
    else {
      a.currentTime = 0;
      void a.play().catch(() => setPlaying(false));
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={failed}
      aria-pressed={playing}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium hover:bg-accent disabled:opacity-50",
        className,
      )}
    >
      {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      {label}
    </button>
  );
}
