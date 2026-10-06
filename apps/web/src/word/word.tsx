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
  return (
    <span lang={lang} className={cn("font-semibold", gender && COLOUR[gender], className)}>
      {text}
    </span>
  );
}
