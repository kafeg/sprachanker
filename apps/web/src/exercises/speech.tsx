import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSpeechHost } from "@/audio/context.ts";
import { MicButton } from "@/audio/mic-button.tsx";
import { type Take, useRecorder } from "@/audio/recorder.ts";
import { TakeButton } from "@/audio/take-button.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { SpecialLetters } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

export function Dictation({ answer, onAnswer, outcome }: RendererProps<"dictation">) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const scope = useRef<HTMLDivElement>(null);
  return (
    <div ref={scope} className="space-y-3">
      <textarea
        rows={2}
        lang={lang}
        value={answer?.text ?? ""}
        disabled={!!outcome}
        placeholder={t("ex.dictationPlaceholder")}
        onChange={(e) => onAnswer({ text: e.target.value })}
        autoCapitalize="off"
        spellCheck={false}
        className="w-full rounded-xl border-2 border-input bg-card p-3 text-xl"
      />
      {!outcome && <SpecialLetters scope={scope} />}
      {outcome?.diff && (
        <p lang={lang} className="text-xl leading-relaxed">
          {outcome.diff.map((d, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a diff is static
              key={i}
              className={cn(
                "mr-1.5 rounded px-1",
                d.op === "equal" && "text-correct",
                d.op === "missing" && "bg-wrong-soft text-wrong underline decoration-dotted",
                d.op === "extra" && "text-wrong line-through",
                d.op === "wrong" && "bg-wrong-soft text-wrong",
              )}
            >
              {d.op === "wrong" ? `${d.actual} → ${d.expected}` : (d.expected ?? d.actual)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** "m:ss" of a length in milliseconds. */
const clock = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Saying it oneself (08; 09): listen to the original (the item's recording, above), record oneself,
 * play one's take beside it. The item counts once recorded — no self-rating. The phrase to repeat is
 * hidden until the first attempt (the ear first) unless the learner shows it or chose it shown.
 */
export function SpeechSelfrate({
  item,
  answer,
  onAnswer,
  heard = true,
  readOnly,
}: RendererProps<"speech_selfrate">) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const host = useSpeechHost();
  const [take, setTake] = useState<{ url: string; ms: number }>();
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [reveal, setReveal] = useState(false);
  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url);
    },
    [take],
  );

  const attempted = answer !== undefined || !!take;
  const textShown = readOnly || host?.showText === "always" || attempted || reveal;
  const own = take?.url ?? (answer?.recording && host ? host.src(answer.recording) : undefined);

  const recorder = useRecorder({ onTake: (recorded) => void taken(recorded) });
  const taken = async (recorded: Take) => {
    setTake({ url: URL.createObjectURL(recorded.blob), ms: recorded.ms });
    setUnsaved(false);
    if (!host?.keepRecordings) return onAnswer({});
    setSaving(true);
    try {
      onAnswer({ recording: await host.save(recorded) });
    } catch {
      // Not kept: the take still plays here and the item counts.
      setUnsaved(true);
      onAnswer({});
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {item.text ? (
        <div className="relative">
          <p
            lang={lang}
            aria-hidden={!textShown}
            className={cn(
              "whitespace-pre-line font-heading text-2xl font-semibold transition-[filter]",
              !textShown && "select-none blur-md",
            )}
          >
            {item.text}
          </p>
          {!textShown && (
            <button
              type="button"
              onClick={() => setReveal(true)}
              className="absolute inset-0 grid place-items-center text-sm font-medium underline"
            >
              {t("speech.showText")}
            </button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">
          {item.media?.audio || item.media?.video
            ? t("speech.answerHeard")
            : t("speech.answerFree")}
        </p>
      )}
      {readOnly ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {own ? (
            <TakeButton src={own} label={t("speech.mine")} />
          ) : answer?.rating ? (
            t(`ex.rate.${answer.rating}`)
          ) : answer ? (
            t("speech.recordedNotKept")
          ) : null}
        </p>
      ) : (
        <div className="flex flex-wrap items-start justify-center gap-4">
          <MicButton
            recorder={recorder.state}
            level={recorder.level}
            waiting={heard ? undefined : "speech.listenFirst"}
            onStart={() => void recorder.start()}
            onStop={recorder.stop}
          />
          {own && (
            <TakeButton
              src={own}
              label={take ? t("speech.mineFor", { time: clock(take.ms) }) : t("speech.mine")}
              className="mt-1.5"
            />
          )}
        </div>
      )}
      {!readOnly && (
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          {recorder.state === "recording"
            ? t("speech.recording")
            : saving
              ? t("speech.saving")
              : unsaved
                ? t("speech.notSaved")
                : attempted
                  ? t("speech.again")
                  : heard
                    ? t("speech.howTo")
                    : null}
        </p>
      )}
    </div>
  );
}
