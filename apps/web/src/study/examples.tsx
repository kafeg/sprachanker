// The example sentences an imported deck brings with a word (04, "Decks"): each in the word's language
// with its translation and its recording, played on request — on the card's answer and in the word sheet.
import type { CardDisplay } from "@sprachanker/schema";
import { cardMediaUrl } from "@/api/client.ts";
import { inLang } from "@/ui/direction.tsx";
import { AudioButton } from "@/ui/media.tsx";
import { cn } from "@/ui/utils.ts";

export function DeckExamples({
  display,
  lang,
  className,
}: {
  display: CardDisplay;
  /** The language the sentences are in (the word's). */
  lang: string | undefined;
  className?: string;
}) {
  if (!display.examples?.length) return null;
  return (
    <ul className={cn("grid gap-2 text-sm", className)}>
      {display.examples.map((e, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, where a sentence may come twice
          key={`${i} ${e.sentence}`}
          className="flex items-start gap-2"
        >
          {e.audio && (
            <AudioButton
              src={cardMediaUrl(display, e.audio)}
              label={e.sentence}
              className="size-9 shrink-0 pointer-coarse:size-11"
            />
          )}
          <span className="grid gap-0.5 text-start">
            <span {...inLang(lang)} className="italic">
              {e.sentence}
            </span>
            {e.translation && <span className="text-muted-foreground">{e.translation}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
