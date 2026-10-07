// A card face as Anki shows it (09): the question; with the answer, the question stays and the answer
// follows under a line. The word's recording sits in the card's corner on the side whose field holds it
// and plays by itself as in Anki: the question's on the question side, the answer's on the answer side
// (not the question's again).
import type { CardDisplay, CardFace } from "@sprachanker/schema";
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { languageName } from "@/i18n/index.ts";
import { AudioButton, type AudioControls } from "@/ui/media.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { GenderWord } from "@/word/word.tsx";

export type Side = "question" | "answer";

/** The card's face, the same on both sides. */
const FACE =
  "grid min-h-56 w-full place-items-center rounded-3xl border bg-card px-6 py-8 text-center max-sm:flex-1 sm:min-h-72";

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
  display,
  face,
  side,
  onTap,
  audio,
  marks,
}: {
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
  const src = display.audio && mediaUrl(display.series, display.audio);
  const lesson = parseLessonKey(display.lessonKey);

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
    ) : face === "listening" && side === "question" ? (
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
        {display.example && (
          <span lang={lang} className="text-sm italic text-muted-foreground">
            {display.example}
          </span>
        )}
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
            <Link
              to="/lesson/$series/$course/$lesson"
              params={{ series: display.series, course: lesson.courseId, lesson: lesson.name }}
              className="text-xs text-muted-foreground underline"
            >
              {t("study.fromLesson", { unit: lesson.unit, lesson: lesson.lesson })}
            </Link>
          </div>
        </div>
      )}
      {marks && <div className="absolute top-3 left-3 flex items-center gap-1.5">{marks}</div>}
      {/* In the card's corner, so a word without a recording keeps the same layout. */}
      {src && wordShown && (
        <AudioButton
          ref={sound}
          src={src}
          label={display.target}
          className="absolute top-3 right-3 size-11"
        />
      )}
    </div>
  );
}
