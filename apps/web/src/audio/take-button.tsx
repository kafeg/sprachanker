// One's own recording played back: a pill with its length; one medium plays at a time. A kept
// one an answer names: played, or said to be deleted (all recordings deleted, the answers kept).
import { Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClip } from "@/ui/playback.tsx";
import { cn } from "@/ui/utils.ts";
import { useSpeechHost } from "./context.ts";

/** A recording an answer or a line holds, by its id: its button, or that it was deleted. */
export function KeptTake({
  id,
  label,
  className,
}: {
  id: string;
  label: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const host = useSpeechHost();
  if (!host) return null;
  if (host.kept?.(id) === false)
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        {t("speech.takeDeleted")}
      </span>
    );
  return <TakeButton src={host.src(id)} label={label} className={className} />;
}

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
