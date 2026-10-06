// respond: a free answer (a translation, a sentence of one's own). Without a rubric it is not scored:
// after checking, the model answer(s) of the course are shown to compare with. A translation into the
// learner's language (`answerIn: "learner"`) has its model answers in the locale item.
import { useTranslation } from "react-i18next";
import { useTargetLang } from "@/ui/target-lang.ts";
import type { RendererProps } from "./types.ts";

export function Respond({ item, locale, answer, onAnswer, outcome }: RendererProps<"respond">) {
  const target = useTargetLang();
  const { t, i18n } = useTranslation();
  const learner = item.answerIn === "learner";
  const lang = learner ? i18n.language : target;
  const reference = [...item.reference, ...(locale?.reference ?? [])];
  return (
    <div className="space-y-3">
      <textarea
        rows={2}
        lang={lang}
        value={answer?.text ?? ""}
        disabled={!!outcome}
        placeholder={t("ex.respondPlaceholder")}
        onChange={(e) => onAnswer({ text: e.target.value })}
        className="w-full rounded-xl border-2 border-input bg-card p-3 text-xl"
      />
      {outcome && reference.length > 0 && (
        <div className="rounded-xl bg-muted px-4 py-3">
          <p className="text-sm font-medium text-muted-foreground">
            {t("ex.reference", { count: reference.length })}
          </p>
          <ul className="mt-1 space-y-1">
            {reference.map((r) => (
              <li key={r} lang={lang} className="text-lg">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
