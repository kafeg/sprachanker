// Saying instead of typing (08): a small microphone beside a text box — a tap records, another stops
// (or held down, by the setting), and what was heard in the language given goes into the box to be
// read over and changed before it is sent. Shown only while recognition is on and ready.
import { LoaderCircle, Mic, Square } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { languageName } from "@/i18n/index.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/tooltip.tsx";
import { cn } from "@/ui/utils.ts";
import { useSpeechHost } from "./context.ts";
import { micState, type Take, useRecorder } from "./recorder.ts";

export function DictateButton({
  lang,
  onText,
  onTake,
  short,
  className,
}: {
  /** The language spoken (never detected, 08). */
  lang: string;
  onText(text: string, take: Take): void;
  /** The take itself too (kept as a spoken answer's recording). */
  onTake?(take: Take): void;
  /** A short label on the button ("DE"), when there is one per language. */
  short?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const host = useSpeechHost();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const recorder = useRecorder({
    onTake: (take) => {
      if (!host) return;
      onTake?.(take);
      setBusy(true);
      setFailed(false);
      host
        .transcribe(take, lang)
        .then((text) => text && onText(text, take))
        .catch(() => setFailed(true))
        .finally(() => setBusy(false));
    },
  });
  if (!host?.recognition || micState() !== "ready") return null;
  const recording = recorder.state === "recording";
  const name = languageName(lang, i18n.language);
  const label = recording ? t("speech.stop") : t("speech.sayIn", { language: name });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={recording}
          disabled={busy}
          onClick={() => (recording ? recorder.stop() : void recorder.start())}
          className={cn(
            "relative grid size-11 shrink-0 place-items-center rounded-full border bg-card text-xs font-semibold hover:bg-accent disabled:opacity-60",
            recording && "border-wrong bg-wrong text-white hover:bg-wrong",
            failed && "border-wrong",
            className,
          )}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : recording ? (
            <Square className="size-3.5 fill-current" />
          ) : short ? (
            <span className="flex items-center gap-0.5">
              <Mic className="size-3.5" />
              {lang.toUpperCase()}
            </span>
          ) : (
            <Mic className="size-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{failed ? t("speech.notHeardShort") : label}</TooltipContent>
    </Tooltip>
  );
}
