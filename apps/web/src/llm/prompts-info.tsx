// Settings → AI assistant → what the model gets: each task's system prompt and the lesson context it
// adds (with limits), plus the switch for the "Prompt" buttons that show a concrete request.
import { useTranslation } from "react-i18next";
import { useCourses, useSetSetting } from "@/api/hooks.ts";
import { DEBUG_PROMPTS, useTaskPrompts } from "./api.ts";
import { useDebugPrompts } from "./prompt-view.tsx";

const PARTS = {
  explain: ["item", "notes"],
  tutor: [
    "lesson",
    "lessonVocab",
    "knownVocab",
    "earlierLessons",
    "grammar",
    "exercise",
    "history",
  ],
} as const;

export function PromptsInfo() {
  const { t, i18n } = useTranslation();
  const courses = useCourses();
  // Prompts name the language being learnt: the target of the installed course.
  const target = courses.data?.[0]?.editions[0]?.split("-")[1] ?? "de";
  const prompts = useTaskPrompts(i18n.language, target);
  const debug = useDebugPrompts();
  const set = useSetSetting();
  return (
    <details className="group rounded-2xl border bg-card p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold">{t("prompt.infoTitle")}</summary>
      <div className="mt-3 space-y-5">
        <p className="text-sm text-muted-foreground">{t("prompt.infoIntro")}</p>
        {(["explain", "tutor"] as const).map((task) => {
          const p = prompts.data?.[task];
          return (
            <section key={task} className="space-y-2">
              <h3 className="font-semibold">{t(`prompt.task.${task}`)}</h3>
              <p className="text-sm">{t("prompt.contextIntro")}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {PARTS[task].map((part) => (
                  <li key={part}>
                    {t(`prompt.part.${part}`)}
                    {p?.budgets[part] !== undefined &&
                      ` — ${t("prompt.upTo", { chars: p.budgets[part] })}`}
                  </li>
                ))}
              </ul>
              {p && (
                <>
                  <p className="text-sm">{t("prompt.systemIntro")}</p>
                  <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[13px] leading-relaxed">
                    {p.system}
                  </pre>
                </>
              )}
            </section>
          );
        })}
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={debug}
            onChange={(e) => set.mutate({ key: DEBUG_PROMPTS, value: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t("prompt.debug")}</span>
            <span className="block text-sm text-muted-foreground">{t("prompt.debugHint")}</span>
          </span>
        </label>
      </div>
    </details>
  );
}
