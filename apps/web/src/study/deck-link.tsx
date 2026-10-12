// The way from a card to its deck in Review → Decks: what the deck has yet to make for the word —
// its audio read aloud (a card's word is never read on the fly), its examples — said in one small
// link, the deck's row in sight there. In a card's corner on a phone it is an icon, its words in its
// name and tooltip, so the corner stays one row beside the recording and "Example".
import { type CardDisplay, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";

/** The deck a card belongs to, as Review → Decks names it: an imported deck, else its course's. */
export const deckOf = (display: CardDisplay) =>
  "deck" in display ? `deck:${display.deck}` : `course:${parseLessonKey(display.lessonKey).course}`;

/** A deck's row in Review → Decks, as a page anchor. */
export const deckAnchor = (scope: string) => `deck-${scope.replace(/[^a-z0-9]+/gi, "-")}`;

export function DeckLink({
  scope,
  audio,
  examples = false,
  compact = false,
  className,
}: {
  scope: string;
  /** The word has no audio: the deck's words are to be read aloud. */
  audio: boolean;
  /** The word has no examples: the deck's are to be made. */
  examples?: boolean;
  /** On a phone, an icon (a card's corner). */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!audio && !examples) return null;
  const label =
    audio && examples
      ? t("study.deckLink.both")
      : audio
        ? t("study.deckLink.audio")
        : t("study.deckLink.examples");
  return (
    <Link
      to="/review/decks"
      hash={deckAnchor(scope)}
      {...(compact && { "aria-label": label, title: label })}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground underline pointer-coarse:min-h-11",
        compact &&
          "max-sm:size-11 max-sm:shrink-0 max-sm:justify-center max-sm:rounded-full max-sm:border max-sm:no-underline",
        className,
      )}
    >
      {compact && <Layers aria-hidden className="size-4 sm:hidden" />}
      <span className={cn(compact && "max-sm:hidden")}>{label}</span>
      <ArrowRight
        aria-hidden
        className={cn("rtl:-scale-x-100 size-3 shrink-0", compact && "max-sm:hidden")}
      />
    </Link>
  );
}
