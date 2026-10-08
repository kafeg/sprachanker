// One's own recording played back (08): a pill with its length; one medium plays at a time.
import { Pause, Play } from "lucide-react";
import { useClip } from "@/ui/playback.tsx";
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
  const { playing, failed, toggle } = useClip(src);
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
