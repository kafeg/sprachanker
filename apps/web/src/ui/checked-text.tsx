// The learner's text as a model checked it (07): the verdict as a badge, the text with the words that
// changed struck through and their fixes, the corrections with why. Presentational: the writing check,
// a spoken answer's check and the Notebook show checks the same way.
import { wordDiff } from "@sprachanker/engine";
import type { SpokenCheck } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useRequiredTargetLang, useTargetLang } from "./target-lang.ts";
import { cn } from "./utils.ts";

export type CheckVerdict = SpokenCheck["verdict"];

const VERDICT_TONE: Record<CheckVerdict, string> = {
  good: "bg-correct-soft text-correct",
  minor_errors: "bg-correct-soft text-correct",
  major_errors: "bg-wrong-soft text-wrong",
  off_task: "bg-wrong-soft text-wrong",
};

/** A check's verdict as a badge (small in a list row). */
export function VerdictBadge({ verdict, small }: { verdict: CheckVerdict; small?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap font-semibold",
        small ? "rounded-md px-2 py-0.5 text-xs" : "rounded-lg px-2.5 py-1 text-sm",
        VERDICT_TONE[verdict],
      )}
    >
      {t(`writing.verdict.${verdict}`)}
    </span>
  );
}

/** The corrected text with the learner's words that changed struck through. */
export function CorrectedText({
  text,
  corrected,
  className,
}: {
  text: string;
  corrected: string;
  className?: string;
}) {
  const lang = useRequiredTargetLang();
  const { diff } = wordDiff(lang, corrected, text);
  return (
    <p lang={lang} className={cn("text-lg leading-relaxed", className)}>
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

/** "wrong → right — why", as the model corrected the learner's text. */
export function Corrections({
  corrections,
  className,
}: {
  corrections: Array<{ wrong: string; right: string; explanation: string }>;
  className?: string;
}) {
  const lang = useTargetLang();
  if (!corrections.length) return null;
  return (
    <ul className={cn("space-y-1.5 text-sm", className)}>
      {corrections.map((c) => (
        <li key={`${c.wrong}→${c.right}`}>
          <span lang={lang}>
            <s className="text-wrong">{c.wrong}</s> →{" "}
            <strong className="text-correct">{c.right}</strong>
          </span>
          <span className="text-muted-foreground"> — {c.explanation}</span>
        </li>
      ))}
    </ul>
  );
}

/** A spoken answer's check: the verdict, the feedback, what was said corrected, the corrections. */
export function SpokenCheckView({
  transcript,
  check,
  header,
}: {
  transcript: string;
  check: SpokenCheck;
  /** Beside the verdict: who checked it, actions. */
  header?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={check.verdict} />
        {header}
      </div>
      <p>{check.feedback}</p>
      {check.corrections.length > 0 && (
        <CorrectedText text={transcript} corrected={check.corrected} className="text-base" />
      )}
      <Corrections corrections={check.corrections} />
    </div>
  );
}
