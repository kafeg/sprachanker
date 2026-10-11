// A card face as Anki shows it (09): the question; with the answer, the question stays and the answer
// follows under a line. The word's recording sits in the card's corner on the side whose field holds it
// and plays by itself as in Anki: the question's on the question side, the answer's on the answer side
// (not the question's again). A word without one is never read on the fly: the answer's corner has the
// way to its deck in Decks, where its words are read aloud (and given examples) at once. Its examples
// (its own, then the AI's) are not shown at first: "Example" beside the recording shows one, again the
// next (owner, 2026-10-12).
import type { CardDisplay, CardFace } from "@sprachanker/schema";
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { Quote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cardAudioUrl } from "@/api/client.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { AudioButton, type AudioControls } from "@/ui/media.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { GenderWord } from "@/word/word.tsx";
import { DeckLink, deckOf } from "./deck-link.tsx";
import { type CardExample, ExampleLine, ownExamples } from "./examples.tsx";
import { useStudySlots } from "./slots.ts";

export type Side = "question" | "answer";

/** The card's face, the same on both sides. The top padding keeps the question clear of the corner,
 *  one row high: the recording's button and, to its left, the way to its deck. */
const FACE =
  "grid min-h-56 w-full place-items-center rounded-3xl border bg-card px-6 pt-16 pb-8 text-center max-sm:flex-1 sm:min-h-72";

/** Which side of a face carries the word (and its recording). */
const WORD_SIDE: Record<CardFace, Side> = {
  recognition: "question",
  production: "answer",
  listening: "question",
};

function Word({ display }: { display: CardDisplay }) {
  return (
    <span className="grid justify-items-center gap-1">
      <GenderWord text={display.target} gender={display.gender} className="text-3xl" />
      {/* Sources often give the plural in the headword already ("die Frau, die Frauen"). */}
      {display.plural && !display.target.includes(display.plural) && (
        <span className="text-muted-foreground">{display.plural}</span>
      )}
    </span>
  );
}

export function StudyCard({
  cardId,
  display,
  face,
  side,
  onTap,
  audio,
  marks,
}: {
  /** The note shown, for what optional features add under the answer. */
  cardId?: string;
  display: CardDisplay;
  face: CardFace;
  side: Side;
  /** A tap on the card (the question side shows the answer, as in AnkiMobile). */
  onTap?(): void;
  /** Lets the reviewer replay the recording (R). */
  audio?: React.RefObject<AudioControls | null>;
  /** Flag, mark and leech, top left. */
  marks?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = useTargetLang();
  const own = useRef<AudioControls>(null);
  const sound = audio ?? own;
  const wordShown = side === "answer" || WORD_SIDE[face] === "question";
  const src = cardAudioUrl(display);
  // An imported deck's word was met in no lesson.
  const lesson =
    "lessonKey" in display
      ? { series: display.series, ...parseLessonKey(display.lessonKey) }
      : undefined;
  const slots = useStudySlots();
  const deck = deckOf(display);
  // Its examples, its own then the AI's (a slot), one shown at a time: 0 none yet, else which.
  const [made, setMade] = useState<CardExample[]>([]);
  const examples = [...ownExamples(display), ...made];
  const [shown, setShown] = useState(0);
  const example = shown ? examples[(shown - 1) % examples.length] : undefined;

  // Autoplay as in Anki: the side's own recording, once, when the side opens.
  useEffect(() => {
    if (src && WORD_SIDE[face] === side) sound.current?.play();
  }, [src, face, side, sound]);

  // Which way the card asks, so a card 2 (translation → word) is not taken for a mistake.
  const asks =
    face === "production"
      ? t("study.asks.production", {
          in: t(`study.asks.in.${lang}`, { defaultValue: languageName(lang ?? "", i18n.language) }),
        })
      : face === "recognition"
        ? t("study.asks.recognition")
        : undefined;
  const question =
    face === "production" ? (
      <span className="text-2xl">{display.translation}</span>
    ) : face === "listening" ? (
      // Heard, not read: the word is in the answer.
      <span className="text-sm text-muted-foreground">{t("study.listen")}</span>
    ) : (
      <Word display={display} />
    );
  const answer =
    face === "production" ? (
      <Word display={display} />
    ) : (
      <span className="grid justify-items-center gap-1.5">
        {face === "listening" && <Word display={display} />}
        <span className="text-xl">{display.translation}</span>
      </span>
    );

  return (
    <div className="relative flex flex-col max-sm:flex-1">
      {side === "question" ? (
        // The question is one button: a tap shows the answer (AnkiMobile).
        <button type="button" data-study-card onClick={onTap} className={FACE}>
          <span className="grid w-full justify-items-center gap-4">
            {asks && <span className="text-sm text-muted-foreground">{asks}</span>}
            {question}
          </span>
        </button>
      ) : (
        // The answer side holds a link (the lesson): no button around it.
        <div data-study-card data-answer className={FACE}>
          <div className="grid w-full justify-items-center gap-4">
            {asks && <span className="text-sm text-muted-foreground">{asks}</span>}
            {question}
            <hr id="answer" className="w-3/4 border-border" />
            {answer}
            {example && (
              <ExampleLine
                example={example}
                display={display}
                lang={lang}
                className="w-full max-w-md"
              />
            )}
            {cardId && slots.examples?.({ cardId, deck, onItems: setMade })}
            {lesson && (
              <Link
                to="/lesson/$series/$course/$lesson"
                params={{ series: lesson.series, course: lesson.courseId, lesson: lesson.name }}
                className="inline-flex items-center text-xs text-muted-foreground underline pointer-coarse:min-h-11"
              >
                {t("study.fromLesson", { unit: lesson.unit, lesson: lesson.lesson })}
              </Link>
            )}
          </div>
        </div>
      )}
      {marks && <div className="absolute top-3 start-3 flex items-center gap-1.5">{marks}</div>}
      {/* In the card's corner: the recording, so a word without one keeps the same layout; with the
          answer, the way to its deck for what it has yet to make for the word (no recording: nothing
          plays, R does nothing). */}
      <div
        data-card-corner
        className="absolute top-3 end-3 flex max-w-[60%] flex-row-reverse items-center gap-2 text-end"
      >
        {src && wordShown && (
          <AudioButton ref={sound} src={src} label={display.target} className="size-11" />
        )}
        {side === "answer" && examples.length > 0 && (
          // One example, again the next: which of how many once shown.
          <Button
            variant="outline"
            size="sm"
            className="h-11 shrink-0"
            aria-pressed={!!example}
            onClick={() => setShown((shown % examples.length) + 1)}
          >
            <Quote className="size-3.5 rtl:-scale-x-100" /> {t("study.example")}
            {example && examples.length > 1 && (
              <span className="tabular-nums text-muted-foreground">
                {t("study.exampleAt", {
                  at: ((shown - 1) % examples.length) + 1,
                  count: examples.length,
                })}
              </span>
            )}
          </Button>
        )}
        {side === "answer" &&
          (cardId && slots.corner ? (
            slots.corner({ cardId, scope: deck, audio: !src })
          ) : (
            <DeckLink scope={deck} audio={!src} />
          ))}
      </div>
    </div>
  );
}
