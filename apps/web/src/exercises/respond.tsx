// respond: a free answer (a translation, a sentence of one's own). Without a rubric it is not scored:
// after checking, the model answer(s) of the course are shown to compare with.
import { useTranslation } from "react-i18next";
import { useTargetLang } from "@/ui/target-lang.ts";
import type { RendererProps } from "./types.ts";

export function Respond({ item, answer, onAnswer, outcome }: RendererProps<"respond">) {
  const lang = useTargetLang();
  const { t } = useTranslation();
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
      {outcome && (
        <div className="rounded-xl bg-muted px-4 py-3">
          <p className="text-sm font-medium text-muted-foreground">
            {t("ex.reference", { count: item.reference.length })}
          </p>
          <ul className="mt-1 space-y-1">
            {item.reference.map((r) => (
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
