// Settings → AI assistant: where the assistant works (each place turned on or off, AiPlaces); under
// Advanced the switch for the {} buttons that show a concrete request, then each task with
// what it adds from the lesson (with limits) and its system prompt — the standing one or the learner's
// own, edited here with {language} and {target} standing for the languages (saved in the profile).
import { AI_PLACES, parseEditionId } from "@sprachanker/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCourses } from "@/api/courses.ts";
import { useEdition } from "@/api/edition.ts";
import { useSetSetting, useSetting } from "@/api/settings.ts";
import { CheckRow } from "@/ui/check-row.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { Panel, panelClass } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { useDebugPrompts } from "./prompt-view.tsx";
import { DEBUG_PROMPTS, type PromptTaskId, useSetPrompt, useTaskPrompts } from "./setup-api.ts";

/** What each task adds from the lesson, in prompt order; a part with a budget shows its limit. */
const PARTS = {
  explain: ["level", "item", "script", "topics", "notes"],
  tutor: [
    "lesson",
    "level",
    "place",
    "earlierLessons",
    "lessonVocab",
    "knownVocab",
    "topics",
    "grammar",
    "exercise",
    "mistakes",
    "history",
    "tools",
  ],
  tutorSection: ["courses", "metWords", "metGrammar", "courseMistakes", "chatHistory"],
  writingTask: [
    "lesson",
    "place",
    "level",
    "lessonVocab",
    "knownVocab",
    "topics",
    "grammar",
    "length",
    "levelCriteria",
  ],
  writing: [
    "lesson",
    "level",
    "lessonVocab",
    "knownVocab",
    "grammar",
    "writingTask",
    "text",
    "levelCriteria",
  ],
  speaking: ["lesson", "level", "lessonVocab", "grammar", "item", "heard", "answer"],
  exam: ["exam", "criteria", "samples", "writtenAnswer"],
  conversation: ["exam", "partner", "conversation"],
  understandingDraft: [
    "lesson",
    "place",
    "level",
    "lessonVocab",
    "knownVocab",
    "topics",
    "grammar",
    "upcoming",
    "lessonScript",
    "characters",
    "genre",
  ],
  understandingJudge: [
    "lesson",
    "place",
    "level",
    "lessonVocab",
    "knownVocab",
    "topics",
    "grammar",
    "upcoming",
    "lessonScript",
    "characters",
    "drafts",
  ],
  understandingQuestions: ["level", "place", "lessonVocab", "knownVocab", "readText", "textFacts"],
  understandingCheck: ["readText", "textQuestions"],
  mistakes: ["lesson", "level", "lessonVocab", "knownVocab", "topics", "grammar", "mistakeGroups"],
  sceneSetup: [
    "lesson",
    "place",
    "level",
    "lessonVocab",
    "knownVocab",
    "topics",
    "grammar",
    "characters",
  ],
  scene: [
    "lesson",
    "characters",
    "level",
    "lessonVocab",
    "knownVocab",
    "topics",
    "grammar",
    "history",
  ],
  sceneSummary: ["level", "dialogueGoals", "dialogue"],
  examples: ["level", "knownVocab", "words"],
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
    <details className={cn(panelClass, "group")}>
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
          <p className="text-sm">
            {t(task === "tutorSection" ? "prompt.contextIntroCourses" : "prompt.contextIntro")}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-muted-foreground">
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
            loading={save.isPending && save.variables?.template !== null}
            disabled={!changed || save.isPending}
            onClick={() => save.mutate({ task, template: text })}
          >
            {t("prompt.save")}
          </Button>
          {prompt.custom && (
            <Button
              variant="outline"
              loading={save.isPending && save.variables?.template === null}
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

/** Where the assistant works: a place turned off is not shown — its button, its step of the lesson;
 *  then whether the lesson's practice is made ahead as it starts. */
export function AiPlaces() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const off = useSetting("llm.offIn");
  const prepare = useSetting("llm.preparePractice");
  return (
    <Panel title={t("prompt.places.title")}>
      <p className="text-sm text-muted-foreground">{t("prompt.places.hint")}</p>
      <div className="mt-1 divide-y">
        {AI_PLACES.map((place) => (
          <CheckRow
            key={place}
            checked={!off.includes(place)}
            onChange={(on) =>
              set.mutate({
                key: "llm.offIn",
                value: on ? off.filter((p) => p !== place) : [...off, place],
              })
            }
            title={t(`prompt.places.${place}.name`)}
            hint={t(`prompt.places.${place}.where`)}
          />
        ))}
        <CheckRow
          checked={prepare}
          onChange={(value) => set.mutate({ key: "llm.preparePractice", value })}
          title={t("prompt.places.prepare")}
          hint={t("prompt.places.prepareHint")}
        />
      </div>
    </Panel>
  );
}

/** The {} switch, then each task's prompt. */
export function PromptsSettings() {
  const { t, i18n } = useTranslation();
  const courses = useCourses();
  // Prompts name the language being learnt: shown for the first started course (else the first one).
  const list = courses.data ?? [];
  const course = list.find((c) => c.started) ?? list[0];
  // The edition the course is shown in, as its page and lessons are.
  const edition = useEdition(course?.series ?? "", course?.course ?? "", course?.editions);
  const target = edition ? parseEditionId(edition).target : undefined;
  const prompts = useTaskPrompts(i18n.language, target);
  const debug = useDebugPrompts();
  const set = useSetSetting();
  return (
    <div className="space-y-4">
      <CheckRow
        className={cn(panelClass, "px-4")}
        checked={debug}
        onChange={(value) => set.mutate({ key: DEBUG_PROMPTS, value })}
        title={t("prompt.debug")}
        hint={t("prompt.debugHint")}
      />
      <section className="space-y-2">
        <h3 className="text-lg font-bold">{t("settings.prompts")}</h3>
        <p className="text-sm text-muted-foreground">{t("prompt.infoIntro")}</p>
        {prompts.data &&
          (Object.keys(PARTS) as PromptTaskId[]).map((task) => (
            <TaskPrompt key={task} task={task} prompt={prompts.data[task]} />
          ))}
      </section>
    </div>
  );
}
