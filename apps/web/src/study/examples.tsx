// Example sentences of a word: those it brings — a course's example, an imported deck's
// sentences with their translations and recordings — and, from a slot, the AI's. Each in the word's
// language with its translation and a button playing it (its recording, else read aloud on request; the
// sentence only, never the translation). On a card one at a time (card.tsx); in the word sheet the
// word's own, listed.
import type { CardDisplay } from "@sprachanker/schema";
import type { ReactNode } from "react";
import { cardMediaUrl } from "@/api/client.ts";
import { said } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { AudioButton } from "@/ui/media.tsx";
import { cn } from "@/ui/utils.ts";

/** One example as shown. */
export interface CardExample {
  /** The sentence as written: read aloud, named. */
  text: string;
  /** As shown, when not as written (the AI's: the words not met yet marked). */
  sentence?: ReactNode;
  translation?: string;
  /** Its recording in the deck's folder (an imported deck's); none: read aloud on request. */
  audio?: string;
  /** Under it (the AI's: the words new here, who wrote it). */
  note?: ReactNode;
}

/** The examples a word brings: a course's example, an imported deck's sentences. */
export const ownExamples = (display: CardDisplay): CardExample[] => [
  ...(display.example ? [{ text: display.example }] : []),
  ...(display.examples ?? []).map((e) => ({
    text: e.sentence,
    translation: e.translation,
    audio: e.audio,
  })),
];

/** One example: its play button, the sentence in the word's language, its translation. */
export function ExampleLine({
  example,
  display,
  lang,
  className,
}: {
  example: CardExample;
  /** The word shown (where its deck's recordings are: needed for an example with one). */
  display?: CardDisplay;
  /** The language the sentence is in (the word's). */
  lang: string | undefined;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2 text-sm", className)}>
      {example.audio && display ? (
        <AudioButton
          src={cardMediaUrl(display, example.audio)}
          label={example.text}
          className="size-9 shrink-0 pointer-coarse:size-11"
        />
      ) : (
        <SpeakButton
          parts={said(example.text, lang)}
          label={example.text}
          className="size-9 shrink-0 pointer-coarse:size-11"
        />
      )}
      <span className="grid gap-0.5 text-start">
        <span {...inLang(lang)} className="italic">
          {example.sentence ?? example.text}
        </span>
        {example.translation && (
          <span className="text-muted-foreground">{example.translation}</span>
        )}
        {example.note}
      </span>
    </div>
  );
}

/** The sentences an imported deck brings with a word, listed (the word sheet). */
export function DeckExamples({
  display,
  lang,
  className,
}: {
  display: CardDisplay;
  lang: string | undefined;
  className?: string;
}) {
  const examples = ownExamples({ ...display, example: undefined });
  if (!examples.length) return null;
  return (
    <ul className={cn("grid gap-2", className)}>
      {examples.map((e, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, where a sentence may come twice
        <li key={`${i} ${e.text}`}>
          <ExampleLine example={e} display={display} lang={lang} />
        </li>
      ))}
    </ul>
  );
}
