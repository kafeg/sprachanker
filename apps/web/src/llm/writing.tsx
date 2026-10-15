// Writing, a practice step of the lesson: a task the model
// sets from the lesson — a situation and three content points, about as many words as the level asks —
// and a text written on it, checked by the model (verdict, the points covered, at most three
// corrections, the level's criteria, a model text). The latest check is shown under the task; earlier
// texts of the lesson are listed with their criteria, each readable again with the task it answered;
// any text can be taken back into the editor to fix it and check it again; "New task" sets another.
import { wordCount } from "@sprachanker/engine";
import { type LessonKey, type WritingTask as Task, WRITING_MAX } from "@sprachanker/schema";
import { PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { languageName } from "@/i18n/index.ts";
import type { PracticePrimary } from "@/lesson/slots.ts";
import { UnderstandingLines } from "@/library/understanding-text.tsx";
import { CorrectedText, Corrections, VerdictBadge as Verdict } from "@/ui/checked-text.tsx";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { inLang } from "@/ui/direction.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { HistoryList } from "@/ui/history.tsx";
import { Panel } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useCheckWriting, useWriting, type WritingAttempt } from "./api.ts";
import { AssistantLabel, modelName } from "./assistant-label.tsx";
import { ErrorLine, Thinking } from "./parts.tsx";
import { NextVariant } from "./practice-next.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";

type Check = WritingAttempt["result"];
const CRITERIA = ["task", "communication", "accuracy"] as const;

/** A score, 0–2, as two dots. */
function Dots({ score }: { score: number }) {
  return [0, 1].map((i) => (
    <span
      key={i}
      className={cn(
        "ms-0.5 inline-block size-2.5 rounded-full",
        i < score ? "bg-correct" : "bg-border",
      )}
    />
  ));
}

/** A score with its words for screen readers and on pointing at it. */
function Score({ score }: { score: number }) {
  const { t } = useTranslation();
  const words = t("writing.points", { score, max: 2 });
  return (
    <span title={words} className="shrink-0 whitespace-nowrap">
      <span className="sr-only">{words}</span>
      <Dots score={score} />
    </span>
  );
}

/** The three criteria as dots, named for screen readers. */
function CriteriaDots({ criteria }: { criteria: Check["criteria"] }) {
  const { t } = useTranslation();
  const scores = CRITERIA.map((k) =>
    t("writing.score", { name: t(`writing.criteria.${k}`), score: criteria[k].score, max: 2 }),
  ).join(", ");
  return (
    <span title={scores} className="shrink-0 whitespace-nowrap">
      <span className="sr-only">{scores}</span>
      {CRITERIA.map((k) => (
        <span key={k} className="me-1.5">
          <Dots score={criteria[k].score} />
        </span>
      ))}
    </span>
  );
}

/** A task as set: the message it answers (what it is, then the text in the language learnt), the
 *  situation, its numbered points, the length. */
function TaskText({ task }: { task: Task }) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  return (
    <div className="space-y-2">
      {task.message && (
        <div className="space-y-2 rounded-xl border bg-card px-4 py-3">
          <p className="text-sm font-semibold text-muted-foreground">{task.message.setting}</p>
          <UnderstandingLines text={task.message} lang={lang} />
        </div>
      )}
      <p>{task.situation}</p>
      <ol className="list-decimal space-y-0.5 ps-6">
        {task.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">{t("writing.length", { words: task.words })}</p>
    </div>
  );
}

/** A check in full: the verdict, feedback, the text with its corrections, the task's points as
 *  covered, the criteria, the model text — a text written, or a monologue said (Speaking's). */
export function CheckResult({
  result: r,
  text,
  points,
  ts,
  model,
  children,
}: {
  result: Check;
  text: string;
  points?: readonly string[];
  ts: number;
  model: string;
  /** What comes under it (fix it and check again). */
  children?: React.ReactNode;
}) {
  const lang = useRequiredTargetLang();
  const { t } = useTranslation();
  const when = useDateFormat("dayTime");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Verdict verdict={r.verdict} />
        <span className="text-sm text-muted-foreground">
          {when.format(ts)} · {modelName(model)}
        </span>
      </div>
      <p>{r.feedback}</p>
      {r.corrections.length > 0 ? (
        <CorrectedText text={text} corrected={r.corrected} />
      ) : (
        <p {...inLang(lang)} className="text-lg leading-relaxed">
          {text}
        </p>
      )}
      <Corrections corrections={r.corrections} />
      {points && r.points && (
        <div>
          <h3 className="mb-1 font-semibold">{t("writing.pointsTitle")}</h3>
          <ol className="space-y-1.5 text-sm">
            {points.map((point, i) => {
              const rated = r.points?.[i];
              return (
                <li key={point} className="rounded-lg bg-muted px-3 py-2">
                  <span className="flex items-start justify-between gap-2 font-medium">
                    <span>
                      {i + 1}. {point}
                    </span>
                    {rated && <Score score={rated.score} />}
                  </span>
                  {rated?.comment && (
                    <span className="block text-muted-foreground">{rated.comment}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <dl className="grid gap-1.5 text-sm sm:grid-cols-3">
        {CRITERIA.map((k) => (
          <div key={k} className="rounded-lg bg-muted px-3 py-2">
            <dt className="flex items-center justify-between font-medium">
              {t(`writing.criteria.${k}`)}
              <Score score={r.criteria[k].score} />
            </dt>
            <dd className="text-muted-foreground">{r.criteria[k].comment}</dd>
          </div>
        ))}
      </dl>
      {r.modelText && (
        <div>
          <h3 className="mb-1 font-semibold">{t("writing.modelText")}</h3>
          <p {...inLang(lang)} className="whitespace-pre-line rounded-lg bg-muted px-3 py-2">
            {r.modelText}
          </p>
        </div>
      )}
      {children}
    </div>
  );
}

/** A writing check with the way to fix the text and check it again. */
function Result({ attempt, onRewrite }: { attempt: WritingAttempt; onRewrite(): void }) {
  const { t } = useTranslation();
  return (
    <CheckResult
      result={attempt.result}
      text={attempt.input}
      points={attempt.writingTask?.points}
      ts={attempt.ts}
      model={attempt.model}
    >
      <Button variant="outline" onClick={onRewrite}>
        <PenLine className="size-4" /> {t("writing.rewrite")}
      </Button>
    </CheckResult>
  );
}

/** Earlier texts of the lesson, newest first, each with its criteria; one opens in full with the
 *  task it answered. */
function PastAttempts({
  attempts,
  onRewrite,
}: {
  attempts: WritingAttempt[];
  onRewrite(attempt: WritingAttempt): void;
}) {
  const lang = useRequiredTargetLang();
  const { t } = useTranslation();
  const when = useDateFormat("dayTime");
  return (
    <HistoryList
      title={t("writing.past")}
      items={attempts}
      keyOf={(a) => a.ts}
      summary={(a) => (
        <span className="block space-y-1">
          <span className="flex items-center gap-3">
            <Verdict verdict={a.result.verdict} small />
            <CriteriaDots criteria={a.result.criteria} />
          </span>
          <span className="flex items-baseline gap-3">
            <span {...inLang(lang)} className="min-w-0 flex-1 truncate">
              {a.input}
            </span>
            <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
              {when.format(a.ts)}
            </span>
          </span>
        </span>
      )}
      detail={(a) => (
        <div className="space-y-3">
          {a.writingTask && (
            <div className="rounded-lg border px-3 py-2 text-sm">
              <TaskText task={a.writingTask} />
            </div>
          )}
          <Result attempt={a} onRewrite={() => onRewrite(a)} />
        </div>
      )}
    />
  );
}

export function WritingTask({
  series,
  lessonKey,
  edition,
  onDone,
  setPrimary,
}: {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  /** A text was checked. */
  onDone?(): void;
  /** The step bar's main button while a text waits for Check (as an exercise's). */
  setPrimary?(primary: PracticePrimary | null): void;
}) {
  const lang = useRequiredTargetLang();
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const state = useWriting(series, lessonKey, edition);
  const check = useCheckWriting(onDone);
  const [text, setText] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const submit = useRef<() => void>(() => {});
  // Check in the step bar while a text is written (waiting while it is checked); Next otherwise.
  const ready = !!text.trim() && !!state.data?.task && !state.data.preparing;
  const busy = check.isPending || !!state.data?.checking;
  // A task of the course's practice is done without a model; checking it needs one.
  const noModel = !llm.isPending && !llm.data?.model;
  useEffect(() => {
    setPrimary?.(
      ready
        ? { label: t("writing.check"), disabled: busy || noModel, run: () => submit.current() }
        : null,
    );
  }, [setPrimary, ready, busy, noModel, t]);
  useEffect(() => () => setPrimary?.(null), [setPrimary]);
  if (!state.data) return null;
  const { task, words, attempts } = state.data;
  const [latest, ...past] = attempts;
  const ids = { series, lessonKey, edition, language: i18n.language };
  // Asked from here, or still running on the server since before this page was opened.
  const checking = check.isPending ? check.variables.text : state.data.checking;
  const preparing = state.data.preparing;
  // A text back in the editor, to fix it after the corrections and check it again.
  const rewrite = (attempt: WritingAttempt) => {
    setText(attempt.input);
    editor.current?.focus();
    editor.current?.scrollIntoView({ block: "center" });
  };
  const count = wordCount(text);
  submit.current = () => {
    if (!task || !text.trim()) return;
    // The text is in the result now; "Fix it and check again" brings it back.
    check.mutate({ ...ids, taskId: task.id, text: text.trim() }, { onSuccess: () => setText("") });
  };

  return (
    <div className="space-y-4">
      {task ? (
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-start gap-2">
            <p className="me-auto font-medium">
              {t("writing.task", { language: languageName(lang, i18n.language) })}
            </p>
            <NextVariant
              ids={{ series, lessonKey, edition }}
              step="writing"
              disabled={!!checking}
            />
          </div>
          <TaskText task={task.result} />
          {noModel && (
            <p className="text-sm text-muted-foreground">{t("practice.checkNeedsModel")}</p>
          )}
          {words.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {words.slice(0, 14).map((w) => (
                <Badge key={w} variant="secondary" {...inLang(lang)}>
                  {w.split(",")[0]}
                </Badge>
              ))}
            </div>
          )}
          <Textarea
            ref={editor}
            {...inLang(lang)}
            className="min-h-28 text-base"
            placeholder={t("writing.placeholder")}
            aria-label={t("writing.placeholder")}
            maxLength={WRITING_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              {t("writing.count", { count, words: task.result.words })}
            </span>
            <PromptButton
              request={() => ({ writing: { ...ids, taskId: task.id, text: text.trim() } })}
            />
            <AssistantLabel className="ms-auto" />
          </div>
          {(preparing || checking) && (
            <Thinking
              label={checking ? t("writing.step.checking") : t("writing.step.task")}
              className="text-sm"
            />
          )}
          <ErrorLine
            error={check.error}
            // Asked again as it was: the text checked (still in the editor).
            onRetry={() =>
              check.variables && check.mutate(check.variables, { onSuccess: () => setText("") })
            }
          />
        </Panel>
      ) : (
        <Panel className="space-y-3">
          <NextVariant ids={{ series, lessonKey, edition }} step="writing" empty />
          {preparing && <Thinking label={t("writing.step.task")} className="text-sm" />}
        </Panel>
      )}
      {latest && (
        <Panel>
          <Result attempt={latest} onRewrite={() => rewrite(latest)} />
        </Panel>
      )}
      <PastAttempts attempts={past} onRewrite={rewrite} />
    </div>
  );
}
