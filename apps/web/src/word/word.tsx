// A German word with its grammatical gender colour (der blue, die red, das green, plural neutral).
import type { Gender } from "@sprachanker/schema";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";

const COLOUR: Record<Gender, string> = {
  m: "text-der",
  f: "text-die",
  n: "text-das",
  pl: "text-plural",
};

/** A space after an article is a no-break one: "die Altenpfleger" never splits at a line's end. Pure. */
export const articlesKept = (text: string) =>
  text.replace(/(?<!\p{L})(der|die|das|den|dem|des) (?=\p{L})/giu, "$1 ");

export function GenderWord({
  text,
  gender,
  className,
}: {
  text: string;
  gender?: Gender;
  className?: string;
}) {
  const lang = useTargetLang();
  // What goes with the word before it ("(auf etwas) an|stoßen"): small, the word the headword.
  const optional = /^(\([^)]*\))\s+(\S[\s\S]*)$/.exec(text);
  return (
    <span lang={lang} className={cn("font-semibold", gender && COLOUR[gender], className)}>
      {optional ? (
        <>
          <span className="text-[0.6em] font-normal text-muted-foreground">{optional[1]}</span>{" "}
          {articlesKept(optional[2] ?? "")}
        </>
      ) : (
        articlesKept(text)
      )}
    </span>
  );
}
