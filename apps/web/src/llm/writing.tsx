// "Write it yourself" on the lesson summary: a short text on the lesson's topic, checked by the model
// (verdict, corrected text, corrections, Goethe A1 writing criteria). Attempts are kept.
import { wordDiff } from "@sprachanker/engine";
import type { LessonKey } from "@sprachanker/schema";
import { LoaderCircle, PenLine } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useCheckWriting, useLlm, useWriting, type WritingAttempt } from "./api.ts";
import { modelName, useAssistantLabel } from "./assistant-label.tsx";
import { Corrections, ErrorLine, PracticeCard } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

type Check = WritingAttempt["result"];

const VERDICT_TONE: Record<Check["verdict"], string> = {
  good: "bg-correct-soft text-correct",
  minor_errors: "bg-correct-soft text-correct",
  major_errors: "bg-wrong-soft text-wrong",
  off_task: "bg-wrong-soft text-wrong",
};

/** The corrected text with the learner's words that changed struck through. */
function CorrectedText({ text, corrected }: { text: string; corrected: string }) {
  const lang = useRequiredTargetLang();
  const { diff } = wordDiff(lang, corrected, text);
  return (
    <p lang={lang} className="text-lg leading-relaxed">
      {diff.map((d, i) => {
        const key = `${i}-${d.op}`;
        if (d.op === "equal") return <span key={key}>{d.expected} </span>;
        return (
          <span key={key}>
            {d.actual && <s className="text-wrong decoration-2">{d.actual}</s>}
            {d.actual && d.expected && " "}
            {d.expected && <strong className="text-correct">{d.expected}</strong>}{" "}
          </span>
        );
      })}
    </p>
  );
}

function Result({ attempt }: { attempt: WritingAttempt }) {
  const { t } = useTranslation();
  const r = attempt.result;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn("rounded-lg px-2.5 py-1 text-sm font-semibold", VERDICT_TONE[r.verdict])}
        >
          {t(`writing.verdict.${r.verdict}`)}
        </span>
        <span className="text-sm text-muted-foreground">{modelName(attempt.model)}</span>
      </div>
      <p>{r.feedback}</p>
      {r.corrections.length > 0 && <CorrectedText text={attempt.text} corrected={r.corrected} />}
      <Corrections corrections={r.corrections} />
      <dl className="grid gap-1.5 text-sm sm:grid-cols-3">
        {(["task", "communication", "accuracy"] as const).map((k) => (
          <div key={k} className="rounded-lg bg-muted px-3 py-2">
            <dt className="flex items-center justify-between font-medium">
              {t(`writing.criteria.${k}`)}
              <span title={`${r.criteria[k].score}/2`}>
                <span className="sr-only">{r.criteria[k].score}/2</span>
                {[0, 1].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "ml-1 inline-block size-2.5 rounded-full",
                      i < r.criteria[k].score ? "bg-correct" : "bg-border",
                    )}
                  />
                ))}
              </span>
            </dt>
            <dd className="text-muted-foreground">{r.criteria[k].comment}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function WritingTask({
  series,
  lessonKey,
  edition,
}: {
  series: string;
  lessonKey: LessonKey;
  edition: string;
}) {
  const lang = useRequiredTargetLang();
  const { t, i18n } = useTranslation();
  const llm = useLlm();
  const label = useAssistantLabel();
  const state = useWriting(series, lessonKey, edition);
  const check = useCheckWriting();
  const [text, setText] = useState("");
  if (!llm.data?.model || !state.data) return null;
  const { topic, words, attempts } = state.data;
  const latest = check.data ?? attempts[0];
  const request = { series, lessonKey, edition, text: text.trim(), language: i18n.language };

  return (
    <PracticeCard icon={PenLine} title={t("writing.title")} label={label}>
      <p>
        {t("writing.task", {
          topic: topic.join("; "),
          language: lang && new Intl.DisplayNames([i18n.language], { type: "language" }).of(lang),
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
        lang={lang}
        className="min-h-28 text-base"
        placeholder={t("writing.placeholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="lg"
          disabled={!request.text || check.isPending}
          onClick={() => check.mutate(request)}
        >
          {check.isPending && <LoaderCircle className="size-4 animate-spin" />}
          {check.isPending ? t("writing.checking") : t("writing.check")}
        </Button>
        <PromptButton request={() => ({ writing: { ...request, text: request.text || "…" } })} />
      </div>
      <ErrorLine error={check.error} />
      {latest && (
        <div className="space-y-2 border-t pt-4">
          {!check.data && (
            <p className="text-sm text-muted-foreground">{t("writing.lastAttempt")}</p>
          )}
          {!check.data && (
            <p lang={lang} className="italic">
              {latest.text}
            </p>
          )}
          <Result attempt={latest} />
        </div>
      )}
      {attempts.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {t("writing.history", { count: attempts.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {attempts.map((a) => (
              <li key={a.ts}>
                <span className="text-muted-foreground">
                  {t(`writing.verdict.${a.result.verdict}`)}:{" "}
                </span>
                <span lang={lang}>{a.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </PracticeCard>
  );
}
