// Dictation (09): the recording heard, its text typed; once checked, the words as the engine's diff
// marks them — right, missing, extra, wrong with the right one.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/ui/components/textarea.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { ANSWER_BOX, SpecialLetters } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

export function Dictation({ answer, onAnswer, outcome }: RendererProps<"dictation">) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const scope = useRef<HTMLDivElement>(null);
  return (
    <div ref={scope} className="space-y-3">
      <Textarea
        rows={2}
        lang={lang}
        value={answer?.text ?? ""}
        disabled={!!outcome}
        placeholder={t("ex.dictationPlaceholder")}
        onChange={(e) => onAnswer({ text: e.target.value })}
        autoCapitalize="off"
        spellCheck={false}
        className={ANSWER_BOX}
      />
      {!outcome && <SpecialLetters scope={scope} />}
      {outcome?.diff && (
        // Words as wrapping chips: spans side by side with no space between have nowhere to break.
        <p lang={lang} className="flex flex-wrap gap-x-1.5 gap-y-1 text-xl leading-relaxed">
          {outcome.diff.map((d, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a diff is static
              key={i}
              className={cn(
                "rounded px-1",
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
