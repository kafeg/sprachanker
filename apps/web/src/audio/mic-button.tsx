// The microphone button (08; 09): a tap starts recording, another stops it; while it records a ring
// follows the loudness. When the microphone cannot be used (plain HTTP, no MediaRecorder, access denied)
// it stays disabled and says why — a tooltip, and on a phone a line under it (no hover there). It is
// `aria-disabled` rather than `disabled`, so it keeps focus and its tooltip.
import { Mic, MicOff, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip.tsx";
import { cn } from "@/ui/utils.ts";
import { type MicState, micState, type RecorderState } from "./recorder.ts";

/** Why the microphone cannot be used now, as a message key; undefined when it can. */
export function micProblem(mic: MicState, recorder: RecorderState): string | undefined {
  if (mic === "insecure") return "speech.mic.insecure";
  if (mic === "unsupported") return "speech.mic.unsupported";
  if (recorder === "denied") return "speech.mic.denied";
  if (recorder === "failed") return "speech.mic.failed";
  return undefined;
}

export function MicButton({
  recorder,
  level,
  waiting,
  onStart,
  onStop,
  className,
}: {
  recorder: RecorderState;
  level: number;
  /** A reason to wait first (the original not heard yet), as a message key. */
  waiting?: string;
  onStart(): void;
  onStop(): void;
  className?: string;
}) {
  const { t } = useTranslation();
  const problem = micProblem(micState(), recorder);
  const recording = recorder === "recording";
  const reason = problem ?? waiting;
  const button = (
    <button
      type="button"
      aria-disabled={!!reason || recorder === "starting"}
      aria-pressed={recording}
      aria-label={recording ? t("speech.stop") : t("speech.record")}
      onClick={() => {
        if (reason || recorder === "starting") return;
        (recording ? onStop : onStart)();
      }}
      className={cn(
        "relative grid size-14 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors aria-disabled:cursor-not-allowed aria-disabled:bg-muted aria-disabled:text-muted-foreground",
        recording && "bg-wrong text-white",
        className,
      )}
    >
      {recording && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full ring-wrong/40 motion-safe:transition-[box-shadow]"
          style={{ boxShadow: `0 0 0 ${Math.round(3 + level * 12)}px var(--color-wrong-soft)` }}
        />
      )}
      {problem ? (
        <MicOff className="relative size-6" />
      ) : recording ? (
        <Square className="relative size-5 fill-current" />
      ) : (
        <Mic className="relative size-6" />
      )}
    </button>
  );
  return (
    <div className="flex flex-col items-center gap-1">
      {reason ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent className="max-w-64">{t(reason)}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      {reason && (
        <p className="hidden max-w-64 text-center text-xs text-muted-foreground pointer-coarse:block">
          {t(reason)}
        </p>
      )}
    </div>
  );
}
