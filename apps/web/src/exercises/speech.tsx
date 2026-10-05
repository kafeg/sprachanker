import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";
import type { RendererProps } from "./types.ts";

export function Dictation({ answer, onAnswer, outcome }: RendererProps<"dictation">) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <textarea
        rows={2}
        lang="de"
        value={answer?.text ?? ""}
        disabled={!!outcome}
        placeholder={t("ex.dictationPlaceholder")}
        onChange={(e) => onAnswer({ text: e.target.value })}
        autoCapitalize="off"
        spellCheck={false}
        className="w-full rounded-xl border-2 border-input bg-card p-3 text-xl"
      />
      {outcome?.diff && (
        <p lang="de" className="text-xl leading-relaxed">
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

export function SpeechSelfrate({ item, answer, onAnswer }: RendererProps<"speech_selfrate">) {
  const { t } = useTranslation();
  const ratings = ["good", "fair", "poor"] as const;
  return (
    <div className="space-y-3">
      {item.text ? (
        <p lang="de" className="font-heading text-2xl font-semibold">
          {item.text}
        </p>
      ) : (
        <p className="text-muted-foreground">{t("ex.selfrateFree")}</p>
      )}
      <p className="text-sm text-muted-foreground">{t("ex.selfrate")}</p>
      <div className="flex flex-wrap gap-2">
        {ratings.map((rating) => (
          <button
            type="button"
            key={rating}
            aria-pressed={answer?.rating === rating}
            onClick={() => onAnswer({ rating })}
            className={cn(
              "min-h-11 rounded-xl border-2 bg-card px-4",
              answer?.rating === rating && "border-primary bg-accent",
            )}
          >
            {t(`ex.rate.${rating}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
