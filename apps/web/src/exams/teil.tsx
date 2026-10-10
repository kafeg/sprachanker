// A Teil of an exam and its questions (09, Exams; 3B): the module where it begins, the Teil's title
// and instructions, the text its questions share, its picture or recording, its example shown
// answered; then each question as an item card, its own text above it and its recording played as
// the Teil allows.
import type { ExamItem, LocaleExam, Outcome } from "@sprachanker/schema";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemCard } from "@/exercises/item-card.tsx";
import { SourceOrder } from "@/exercises/shared.tsx";
import { Button } from "@/ui/components/button.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { type ExamSection, examExercise, exampleAnswer } from "./questions.ts";
import { ExamRecording } from "./recording.tsx";

/** A text of the exam (target language): paragraphs by blank lines, lines kept. */
function ExamText({ text, className }: { text: string; className?: string }) {
  const lang = useRequiredTargetLang();
  return (
    <div
      lang={lang}
      className={cn("space-y-3 rounded-xl bg-muted/60 p-4 leading-relaxed", className)}
    >
      {text.split(/\n{2,}/).map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of a fixed text
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}

export function TeilHeader({
  section,
  locale,
  module,
  example,
  limited,
  run,
  url,
}: {
  section: ExamSection;
  locale: LocaleExam | null;
  /** The module's title, where a module begins. */
  module?: string;
  example?: ExamItem;
  /** A mock exam: recordings played only as often as the Teil allows. */
  limited: boolean;
  run: string;
  url(path: string): string;
}) {
  const { t } = useTranslation();
  const texts = locale?.sections[section.key];
  return (
    <div className="mb-6 space-y-3 pt-2">
      {module && <h2 className="font-heading text-2xl font-bold">{module}</h2>}
      {texts?.title && <h3 className="font-heading text-lg font-bold">{texts.title}</h3>}
      {texts?.instructions && <p className="text-muted-foreground">{texts.instructions}</p>}
      {section.plays !== undefined && (
        <p className="text-sm text-muted-foreground">
          {t("exams.plays", { count: section.plays })}
        </p>
      )}
      {section.media?.audio && (
        <ExamRecording
          src={url(section.media.audio)}
          label={texts?.title ?? section.key}
          plays={limited ? section.plays : undefined}
          run={run}
        />
      )}
      {section.media?.image && (
        <img src={url(section.media.image)} alt="" className="max-h-96 rounded-xl border" />
      )}
      {section.text && <ExamText text={section.text} />}
      {example && (
        <div>
          <p className="mb-1.5 text-sm text-muted-foreground">{t("exams.example")}</p>
          <SourceOrder.Provider value>
            <ItemCard
              exercise={examExercise(example)}
              locale={null}
              index={0}
              answer={exampleAnswer(example)}
              outcome={{ result: "correct", score: 1, ruleIds: [], lexemes: [] }}
              url={url}
            />
          </SourceOrder.Provider>
        </div>
      )}
    </div>
  );
}

/** A typed answer is kept as a draft while it is typed: a mock exam takes it after a pause in typing
 *  (and when the page is left), practice when "Check" is pressed — never each keystroke. */
const SETTLE_MS = 800;

/** One question: its label, its own text, its recording (played as the Teil allows in a mock
 *  exam), then its card. */
export function QuestionCard({
  item,
  label,
  answer,
  outcome,
  onAnswer,
  checkAtOnce = false,
  plays,
  run,
  url,
}: {
  item: ExamItem;
  label: string;
  answer: unknown;
  outcome?: Outcome;
  onAnswer?(answer: unknown): void;
  /** Practice: a typed answer is checked when "Check" is pressed. */
  checkAtOnce?: boolean;
  /** How often its recording may be played (a mock exam); none: freely. */
  plays?: number;
  run: string;
  url(path: string): string;
}) {
  const { t } = useTranslation();
  const typed = item.type !== "single_choice";
  const [draft, setDraft] = useState<unknown>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef<{ draft: unknown; send?: (a: unknown) => void }>({ draft: undefined });
  latest.current = { draft, send: onAnswer };
  const commit = () => {
    clearTimeout(timer.current);
    const { draft: d, send } = latest.current;
    if (d !== undefined) {
      send?.(d);
      setDraft(undefined);
    }
  };
  // Leaving the page: what was typed is taken.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, reads the latest through a ref
  useEffect(() => () => commit(), []);
  const change =
    onAnswer &&
    ((a: unknown) => {
      if (!typed) return onAnswer(a);
      setDraft(a);
      clearTimeout(timer.current);
      if (!checkAtOnce) timer.current = setTimeout(commit, SETTLE_MS);
    });
  const filled =
    draft !== undefined &&
    Object.values(draft as Record<string, unknown>).some((v) => `${v ?? ""}`.trim());
  return (
    <>
      <p className="mb-1.5 text-sm text-muted-foreground">{label}</p>
      {item.text && <ExamText text={item.text} className="mb-3" />}
      {item.media?.audio && (
        <ExamRecording
          src={url(item.media.audio)}
          label={item.prompt ?? label}
          plays={plays}
          run={run}
          className="mb-3"
        />
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: focus leaving the card's own fields, no interaction of its own */}
      <div onBlur={typed && !checkAtOnce ? commit : undefined}>
        <SourceOrder.Provider value>
          <ItemCard
            exercise={examExercise(item, false)}
            locale={null}
            index={0}
            answer={draft ?? answer}
            outcome={outcome}
            url={url}
            onAnswer={change}
          />
        </SourceOrder.Provider>
      </div>
      {typed && checkAtOnce && onAnswer && (
        <Button variant="outline" className="mt-3" disabled={!filled} onClick={commit}>
          {t("lesson.check")}
        </Button>
      )}
    </>
  );
}
