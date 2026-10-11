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
import { inLang } from "@/ui/direction.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { type ExamSection, examExercise, exampleAnswer } from "./questions.ts";
import { ExamRecording } from "./recording.tsx";

/** A text of the exam (target language): paragraphs by blank lines, lines kept. */
function ExamText({ text, className }: { text: string; className?: string }) {
  const lang = useRequiredTargetLang();
  return (
    <div
      {...inLang(lang)}
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

/** A Teil's picture, text and the letters its questions are answered from (ads, pictures — each
 *  once): what its questions are about (beside the question on a wide screen). */
export function TeilMaterial({
  section,
  locale,
  url,
}: {
  section: ExamSection;
  locale?: LocaleExam | null;
  url(path: string): string;
}) {
  const lang = useRequiredTargetLang();
  const alt = locale?.sections[section.key]?.alt;
  if (!section.media?.image && !section.text && !section.letters?.length) return null;
  return (
    <div className="space-y-3">
      {section.media?.image && (
        <img src={url(section.media.image)} alt="" className="max-h-96 rounded-xl border" />
      )}
      {section.text && <ExamText text={section.text} />}
      {section.letters?.length ? (
        <ul
          className={cn(
            "grid gap-2",
            section.letters.some((l) => l.text)
              ? "grid-cols-1"
              : "grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]",
          )}
        >
          {section.letters.map((l) => (
            <li key={l.letter} className="flex gap-3 rounded-xl border bg-card p-3">
              <span className="font-heading text-lg font-bold">{l.letter}</span>
              <div className="min-w-0 flex-1 space-y-2">
                {l.media?.image && (
                  <img
                    src={url(l.media.image)}
                    alt={alt?.[l.letter] ?? ""}
                    className="max-h-48 rounded-lg"
                  />
                )}
                {l.text && (
                  <p {...inLang(lang)} className="whitespace-pre-line text-sm leading-relaxed">
                    {l.text}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TeilHeader({
  section,
  locale,
  module,
  examples = [],
  examplesOpen = true,
  withMaterial = true,
  limited,
  run,
  url,
}: {
  section: ExamSection;
  locale: LocaleExam | null;
  /** The module's title, said with the Teil's ("Hören · Teil 2"). */
  module?: string;
  examples?: ExamItem[];
  /** The examples shown open (the Teil's first question), else folded. */
  examplesOpen?: boolean;
  /** Its picture and text too; off where the page shows them apart (`TeilMaterial`). */
  withMaterial?: boolean;
  /** A mock exam: recordings played only as often as the Teil allows. */
  limited: boolean;
  run: string;
  url(path: string): string;
}) {
  const { t } = useTranslation();
  const texts = locale?.sections[section.key];
  const title = [module, texts?.title].filter(Boolean).join(" · ");
  return (
    <div className="mb-5 space-y-3">
      {title && <h3 className="font-heading text-lg font-bold">{title}</h3>}
      {texts?.instructions && (
        <p className="whitespace-pre-line text-muted-foreground">{texts.instructions}</p>
      )}
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
      {withMaterial && <TeilMaterial section={section} locale={locale} url={url} />}
      {examples.length > 0 && (
        <details open={examplesOpen} className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground pointer-coarse:min-h-11">
            {t("exams.example")}
          </summary>
          <div className="mt-2 space-y-3">
            {examples.map((example) => (
              <SourceOrder.Provider key={example.key} value>
                <ItemCard
                  exercise={examExercise(example)}
                  locale={null}
                  index={0}
                  answer={exampleAnswer(example)}
                  outcome={{ result: "correct", score: 1 }}
                  url={url}
                />
              </SourceOrder.Provider>
            ))}
          </div>
        </details>
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
  active = false,
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
  /** The question on screen: number keys choose its options. */
  active?: boolean;
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
  // Leaving a mock exam's page: what was typed is taken (practice takes only what "Check" sends).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, reads the latest through a ref
  useEffect(() => () => (checkAtOnce ? undefined : commit()), []);
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
    // A question's own region, named by its label (an example above is the Teil's, not its).
    <section aria-label={label || undefined}>
      {label && <p className="mb-1.5 text-sm text-muted-foreground">{label}</p>}
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
            active={active}
          />
        </SourceOrder.Provider>
      </div>
      {typed && checkAtOnce && onAnswer && (
        <Button variant="outline" className="mt-3" disabled={!filled} onClick={commit}>
          {t("lesson.check")}
        </Button>
      )}
    </section>
  );
}
