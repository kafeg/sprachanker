// Settings → Prompts: where the assistant works (each place turned on or off), the switch for the {}
// buttons that show a concrete request, then each task with
// what it adds from the lesson (with limits) and its system prompt — the standing one or the learner's
// own, edited here with {language} and {target} standing for the languages (saved in the profile).
import { AI_PLACES, parseEditionId } from "@sprachanker/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCourses, useSetSetting, useSetting } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { DEBUG_PROMPTS, type PromptTaskId, useSetPrompt, useTaskPrompts } from "./api.ts";
import { useDebugPrompts } from "./prompt-view.tsx";

/** What each task adds from the lesson, in prompt order; a part with a budget shows its limit. */
const PARTS = {
  explain: ["item", "script", "notes"],
  tutor: [
    "lesson",
    "earlierLessons",
    "lessonVocab",
    "knownVocab",
    "grammar",
    "exercise",
    "mistakes",
    "history",
    "tools",
  ],
  writing: ["lesson", "lessonVocab", "grammar", "text"],
  speaking: ["lesson", "lessonVocab", "grammar", "item", "heard", "answer"],
  sceneSetup: ["lesson", "lessonVocab", "knownVocab"],
  scene: ["lesson", "lessonVocab", "knownVocab", "history"],
  example: ["word", "courseVocab", "earlier"],
} as const;

type Prompt = {
  system: string;
  template: string;
  custom: boolean;
  budgets: Record<string, number>;
};

function TaskPrompt({ task, prompt }: { task: PromptTaskId; prompt: Prompt }) {
  const { t } = useTranslation();
  const save = useSetPrompt();
  const [text, setText] = useState(prompt.template);
  useEffect(() => setText(prompt.template), [prompt.template]);
  const changed = text.trim() !== prompt.template.trim();
  return (
    <details className="group rounded-2xl border bg-card">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 font-semibold">
        {t(`prompt.task.${task}`)}
        {prompt.custom && (
          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium">
            {t("prompt.custom")}
          </span>
        )}
      </summary>
      <div className="space-y-3 border-t px-4 py-4">
        <p className="text-sm">{t(`prompt.about.${task}`)}</p>
        <div>
          <p className="text-sm">{t("prompt.contextIntro")}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {PARTS[task].map((part: string) => (
              <li key={part}>
                {t(`prompt.part.${part}`)}
                {prompt.budgets[part] !== undefined &&
                  ` — ${t("prompt.upTo", { chars: prompt.budgets[part] })}`}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm">{t("prompt.systemIntro")}</p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            className="font-mono text-[13px] leading-relaxed"
          />
          <p className="text-xs text-muted-foreground">{t("prompt.placeholders")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!changed || save.isPending}
            onClick={() => save.mutate({ task, template: text })}
          >
            {t("prompt.save")}
          </Button>
          {prompt.custom && (
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => save.mutate({ task, template: null })}
            >
              {t("prompt.restore")}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}

/** Where the assistant works: a place turned off is not shown — its button, its step of the lesson. */
function AiPlaces() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const off = useSetting("llm.offIn");
  return (
    <section className="rounded-2xl border bg-card px-4 py-3">
      <h2 className="font-semibold">{t("prompt.places.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("prompt.places.hint")}</p>
      <div className="mt-1 divide-y">
        {AI_PLACES.map((place) => (
          <label key={place} className="flex min-h-11 items-center gap-3 py-2">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={!off.includes(place)}
              onChange={(e) =>
                set.mutate({
                  key: "llm.offIn",
                  value: e.target.checked ? off.filter((p) => p !== place) : [...off, place],
                })
              }
            />
            <span>
              <span className="font-medium">{t(`prompt.places.${place}.name`)}</span>
              <span className="block text-sm text-muted-foreground">
                {t(`prompt.places.${place}.where`)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

export function PromptsSettings() {
  const { t, i18n } = useTranslation();
  const courses = useCourses();
  // Prompts name the language being learnt: shown for the first started course (else the first one).
  const list = courses.data ?? [];
  const course = list.find((c) => c.started) ?? list[0];
  const edition = course?.editions[0];
  const target = edition ? parseEditionId(edition).target : undefined;
  const prompts = useTaskPrompts(i18n.language, target);
  const debug = useDebugPrompts();
  const set = useSetSetting();
  return (
    <div className="space-y-4">
      <AiPlaces />
      <label className="flex min-h-11 items-center gap-3 rounded-2xl border bg-card px-4 py-3">
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
      <p className="text-sm text-muted-foreground">{t("prompt.infoIntro")}</p>
      {prompts.data &&
        (Object.keys(PARTS) as PromptTaskId[]).map((task) => (
          <TaskPrompt key={task} task={task} prompt={prompts.data[task]} />
        ))}
    </div>
  );
}
