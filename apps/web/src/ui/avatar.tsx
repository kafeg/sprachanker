// A profile's round tile: the first letter of its name on its colour (a person, not a word: the gender
// hues are not used).
import { cn } from "./utils.ts";

const COLOUR: Record<string, string> = {
  amber: "bg-amber-300 text-amber-950",
  teal: "bg-teal-300 text-teal-950",
  rose: "bg-rose-300 text-rose-950",
  violet: "bg-violet-300 text-violet-950",
  sky: "bg-sky-300 text-sky-950",
  lime: "bg-lime-300 text-lime-950",
};

export function Avatar({
  name,
  colour,
  className,
}: {
  name: string;
  colour: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full font-bold",
        COLOUR[colour] ?? COLOUR.amber,
        className,
      )}
    >
      {(name.trim()[0] ?? "?").toLocaleUpperCase()}
    </span>
  );
}
