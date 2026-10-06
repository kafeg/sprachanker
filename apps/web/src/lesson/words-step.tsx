// "Words of the lesson" (09): the lesson's words one card at a time — listen, tap for the translation and
// an example, "already known" or next — then what goes to Review; "Done" makes the cards (known ones set
// aside) and marks the step.
import type { Lesson, LexemeKey, LocaleLesson } from "@sprachanker/schema";
import { ArrowLeft, Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLessonCards } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import { AudioButton } from "@/ui/media.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { GenderWord } from "@/word/word.tsx";
import { StepBar } from "./steps.tsx";

export function WordsStep({
  series,
  lesson,
  locale,
  url,
  done,
  saving,
  onDone,
  onSkip,
  onBack,
}: {
  series: string;
  lesson: Lesson;
  locale: LocaleLesson | null;
  url(path: string): string;
  /** The step was done in this run already: the summary of the words opens first. */
  done: boolean;
  saving: boolean;
  onDone(known: LexemeKey[]): void;
  /** Leaves the step undone (no cards are made). */
  onSkip(): void;
  onBack(): void;
}) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const cards = useLessonCards(series, lesson.key);
  const words = lesson.vocab;
  const [index, setIndex] = useState(done ? words.length : 0);
  const [shown, setShown] = useState(false);
  // Known words: the learner's marks here, else the cards already set aside.
  const [marked, setMarked] = useState<Map<string, boolean>>(new Map());
  const isKnown = (lexeme: string) =>
    marked.get(lexeme) ?? cards.data?.words[lexeme]?.suspended ?? false;
  const known = words.filter((w) => isKnown(w.lexeme)).map((w) => w.lexeme as LexemeKey);
  const word = words[index];
  const go = (to: number) => {
    setIndex(to);
    setShown(false);
  };
  const mark = (lexeme: string, value: boolean) =>
    setMarked((prev) => new Map(prev).set(lexeme, value));

  return (
    <article className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t("lesson.step.words")}
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{locale?.title}</h1>
        </div>
        {word && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {t("words.position", { n: index + 1, total: words.length })}
          </span>
        )}
      </div>

      {word ? (
        <>
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-expanded={shown}
            className="grid min-h-72 place-items-center gap-3 rounded-3xl border bg-card px-6 py-8 text-center"
          >
            <span className="grid justify-items-center gap-3">
              {word.image && (
                <img src={url(word.image)} alt="" className="max-h-40 w-auto rounded-xl" />
              )}
              <GenderWord text={word.target} gender={word.gender} className="text-3xl" />
              {(word.forms || word.note) && (
                <span className="text-muted-foreground">
                  {[word.forms, word.note].filter(Boolean).join(" · ")}
                </span>
              )}
              {shown ? (
                <span className="grid gap-1.5 border-t pt-3">
                  <span className="text-xl">{locale?.vocab[word.key]?.translation}</span>
                  {word.examples?.[0] && (
                    <span className="text-sm">
                      <span lang={lang} className="italic">
                        {word.examples[0]}
                      </span>
                      {locale?.vocab[word.key]?.examples?.[0] && (
                        <span className="text-muted-foreground">
                          {" "}
                          — {locale.vocab[word.key]?.examples?.[0]}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">{t("words.tapToShow")}</span>
              )}
            </span>
          </button>
          <div className="flex items-center justify-center gap-3">
            {index > 0 && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("words.previous")}
                onClick={() => go(index - 1)}
              >
                <ArrowLeft className="size-5" />
              </Button>
            )}
            {word.audio && (
              <AudioButton src={url(word.audio)} label={word.target} className="size-12" />
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="lg"
              aria-pressed={isKnown(word.lexeme)}
              onClick={() => {
                mark(word.lexeme, !isKnown(word.lexeme));
                if (!isKnown(word.lexeme)) go(index + 1);
              }}
            >
              {isKnown(word.lexeme) && <Check className="size-4" />}
              {t("words.known")}
            </Button>
            <Button size="lg" className="w-40 text-base" onClick={() => go(index + 1)}>
              {t("lesson.next")}
            </Button>
          </div>
        </>
      ) : (
        // All seen: what goes to Review, the known ones can still be changed.
        <div className="space-y-3">
          <p>
            {t("words.summary", {
              review: words.length - known.length,
              known: known.length,
            })}
          </p>
          <ul className="divide-y rounded-2xl border bg-card">
            {words.map((w) => (
              <li key={w.key} className="flex items-center gap-3 px-4 py-2">
                <GenderWord text={w.target} gender={w.gender} className="flex-1" />
                <span className="text-sm text-muted-foreground">
                  {locale?.vocab[w.key]?.translation}
                </span>
                <button
                  type="button"
                  aria-pressed={isKnown(w.lexeme)}
                  onClick={() => mark(w.lexeme, !isKnown(w.lexeme))}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-sm",
                    isKnown(w.lexeme) && "border-correct bg-correct-soft text-correct",
                  )}
                >
                  {t("words.known")}
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => go(0)}>
            {t("words.again")}
          </Button>
        </div>
      )}

      <StepBar
        onBack={onBack}
        onNext={word ? () => go(words.length) : () => onDone(known)}
        next={word ? t("words.toEnd") : saving ? t("words.saving") : t("words.done")}
        onSkip={done ? undefined : onSkip}
      />
    </article>
  );
}
