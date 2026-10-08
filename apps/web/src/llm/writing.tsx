// "Write it yourself", a practice step of the lesson, on the step's page: a short text on the lesson's
// topic, checked by the model (verdict, corrected text, corrections, Goethe A1 writing criteria). The
// latest check is shown under the task; earlier texts of the lesson are listed with their criteria, each
// readable again; any text can be taken back into the editor to fix it and check it again.
import { type LessonKey, WRITING_MAX } from "@sprachanker/schema";
import { PenLine } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { languageName } from "@/i18n/index.ts";
import { CorrectedText, Corrections, VerdictBadge as Verdict } from "@/ui/checked-text.tsx";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { HistoryList } from "@/ui/history.tsx";
import { Panel } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useCheckWriting, useLlm, useWriting, type WritingAttempt } from "./api.ts";
import { AssistantLabel, modelName } from "./assistant-label.tsx";
import { ErrorLine } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

type Check = WritingAttempt["result"];
const CRITERIA = ["task", "communication", "accuracy"] as const;

/** A criterion's score, 0–2, as two dots. */
function Dots({ score }: { score: number }) {
  return [0, 1].map((i) => (
    <span
      key={i}
      className={cn(
        "ml-0.5 inline-block size-2.5 rounded-full",
        i < score ? "bg-correct" : "bg-border",
      )}
    />
  ));
}

/** The three criteria as dots, named for screen readers. */
function CriteriaDots({ criteria }: { criteria: Check["criteria"] }) {
  const { t } = useTranslation();
  const scores = CRITERIA.map((k) => `${t(`writing.criteria.${k}`)} ${criteria[k].score}/2`).join(
    ", ",
  );
  return (
    <span title={scores} className="shrink-0 whitespace-nowrap">
      <span className="sr-only">{scores}</span>
      {CRITERIA.map((k) => (
        <span key={k} className="mr-1.5">
          <Dots score={criteria[k].score} />
        </span>
      ))}
    </span>
  );
}

/** A check in full: the verdict, feedback, the text with its corrections and the criteria. */
function Result({ attempt, onRewrite }: { attempt: WritingAttempt; onRewrite(): void }) {
  const lang = useRequiredTargetLang();
  const { t } = useTranslation();
  const when = useDateFormat("dayTime");
  const r = attempt.result;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Verdict verdict={r.verdict} />
        <span className="text-sm text-muted-foreground">
          {when.format(attempt.ts)} · {modelName(attempt.model)}
        </span>
      </div>
      <p>{r.feedback}</p>
      {r.corrections.length > 0 ? (
        <CorrectedText text={attempt.text} corrected={r.corrected} />
      ) : (
        <p lang={lang} className="text-lg leading-relaxed">
          {attempt.text}
        </p>
      )}
      <Corrections corrections={r.corrections} />
      <dl className="grid gap-1.5 text-sm sm:grid-cols-3">
        {CRITERIA.map((k) => (
          <div key={k} className="rounded-lg bg-muted px-3 py-2">
            <dt className="flex items-center justify-between font-medium">
              {t(`writing.criteria.${k}`)}
              <span title={`${r.criteria[k].score}/2`}>
                <span className="sr-only">{r.criteria[k].score}/2</span>
                <Dots score={r.criteria[k].score} />
              </span>
            </dt>
            <dd className="text-muted-foreground">{r.criteria[k].comment}</dd>
          </div>
        ))}
      </dl>
      <Button variant="outline" onClick={onRewrite}>
        <PenLine className="size-4" /> {t("writing.rewrite")}
      </Button>
    </div>
  );
}

/** Earlier texts of the lesson, newest first, each with its criteria; one opens in full. */
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
            <span lang={lang} className="min-w-0 flex-1 truncate">
              {a.text}
            </span>
            <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
              {when.format(a.ts)}
            </span>
          </span>
        </span>
      )}
      detail={(a) => <Result attempt={a} onRewrite={() => onRewrite(a)} />}
    />
  );
}

export function WritingTask({
  series,
  lessonKey,
  edition,
  onDone,
}: {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  /** A text was checked. */
  onDone?(): void;
}) {
  const lang = useRequiredTargetLang();
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const state = useWriting(series, lessonKey, edition);
  const check = useCheckWriting(onDone);
  const [text, setText] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  if (!llm.data?.model || !state.data) return null;
  const { topic, words, attempts } = state.data;
  const [latest, ...past] = attempts;
  // Asked from here, or still being checked on the server since before this page was opened.
  const checking = check.isPending ? check.variables.text : state.data.checking;
  const request = { series, lessonKey, edition, text: text.trim(), language: i18n.language };
  // A text back in the editor, to fix it after the corrections and check it again.
  const rewrite = (attempt: WritingAttempt) => {
    setText(attempt.text);
    editor.current?.focus();
    editor.current?.scrollIntoView({ block: "center" });
  };

  return (
    <div className="space-y-4">
      <Panel className="space-y-4">
        <p>
          {t("writing.task", {
            topic: topic.join("; "),
            language: lang && languageName(lang, i18n.language),
          })}
        </p>
        {words.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {words.slice(0, 14).map((w) => (
              <Badge key={w} variant="secondary" lang={lang}>
                {w.split(",")[0]}
              </Badge>
            ))}
          </div>
        )}
        <Textarea
          ref={editor}
          lang={lang}
          className="min-h-28 text-base"
          placeholder={t("writing.placeholder")}
          maxLength={WRITING_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="lg"
            loading={!!checking}
            disabled={!request.text}
            onClick={() =>
              // The text is in the result now; "Fix it and check again" brings it back.
              check.mutate(request, { onSuccess: () => setText("") })
            }
          >
            {checking ? t("writing.checking") : t("writing.check")}
          </Button>
          <PromptButton request={() => ({ writing: { ...request, text: request.text || "…" } })} />
          <AssistantLabel className="ml-auto" />
        </div>
        <ErrorLine error={check.error} />
      </Panel>
      {latest && (
        <Panel>
          <Result attempt={latest} onRewrite={() => rewrite(latest)} />
        </Panel>
      )}
      <PastAttempts attempts={past} onRewrite={rewrite} />
    </div>
  );
}
