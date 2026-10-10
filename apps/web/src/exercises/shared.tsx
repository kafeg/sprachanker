import type { LocaleItem, Option, Outcome } from "@sprachanker/schema";
import { Check, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";

/**
 * Whether a part of an item — a gap, a match pair — was right, as the engine marked it (04); an
 * outcome stored before parts were marked counts as a whole.
 */
export const partRight = (outcome: Outcome | undefined, part: string) =>
  outcome?.parts?.[part] ?? outcome?.result === "correct";

/**
 * The pass an item is shown in (its run): options are ordered anew for every pass, so a lesson done
 * again is not answered by where things were; within a pass (a reload, the Notebook showing it) the
 * order stays.
 */
export const ShuffleSeed = createContext("");

/** `items` in an order fixed by `seed` (display order is not the canonical order, 02). Pure. */
export function shuffled<T>(items: T[], seed: string): T[] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  const rand = () => {
    h = (h * 1103515245 + 12345) | 0;
    return (h >>> 0) / 2 ** 32;
  };
  return items
    .map((x) => [rand(), x] as const)
    .sort((a, b) => a[0] - b[0])
    .map((x) => x[1]);
}

/** Options in the source's order, never shuffled: an exam shows them as its paper does (a, b, c;
 *  Richtig before Falsch; "0" last). */
export const SourceOrder = createContext(false);

/** Stable shuffled order for one item in the pass it is shown in (the source's within an exam). */
export function useShuffled<T>(items: T[], seed: string): T[] {
  const pass = useContext(ShuffleSeed);
  const keep = useContext(SourceOrder);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reshuffle only for another item or pass
  return useMemo(() => (keep ? items : shuffled(items, `${pass}:${seed}`)), [pass, seed, keep]);
}

/** An option checked: chosen and right, chosen and wrong, or right and not chosen (missed). */
export type Mark = "correct" | "wrong" | "missed" | undefined;

/** An option as shown: its target-language text, or its text in the learner's language (the locale
 *  file's), and its picture's description. */
export type ShownOption = Option & { learnerText?: string; alt?: string };

/** The options of an item with what the locale file says of them. */
export const shownOptions = (options: Option[], locale: LocaleItem | undefined): ShownOption[] =>
  options.map((o) => ({
    ...o,
    ...(locale?.options?.[o.id] !== undefined && { learnerText: locale.options[o.id] }),
    ...(locale?.alt?.[o.id] !== undefined && { alt: locale.alt[o.id] }),
  }));

export function OptionContent({
  option,
  url,
  fill = false,
}: {
  option: ShownOption;
  url(path: string): string;
  /** A picture fills the option's width (options laid out as a grid of pictures). */
  fill?: boolean;
}) {
  const lang = useTargetLang();
  if (option.media?.image) {
    const picture = (
      <img
        src={url(option.media.image)}
        alt={option.alt ?? ""}
        className={cn(
          "rounded-lg",
          fill ? "aspect-[4/3] w-full object-contain" : "h-28 w-auto sm:h-32",
        )}
      />
    );
    // A picture with its own label (an exam's "a", "b", or a word under it): both shown.
    if (option.text === undefined) return picture;
    return (
      <span className="flex flex-col items-center gap-1">
        {picture}
        <span lang={lang} className="text-base">
          {option.text}
        </span>
      </span>
    );
  }
  // The learner's language is the page's: no `lang` of the target's on it.
  if (option.text === undefined && option.learnerText !== undefined)
    return <span>{option.learnerText}</span>;
  return <span lang={lang}>{option.text}</span>;
}

/** A written answer's box (dictation, respond) over the ui Textarea: large type, it grows with the
 *  text; once checked it reads as the answer given, not as a field. */
export const ANSWER_BOX =
  "min-h-20 rounded-xl border-2 bg-card p-3 text-xl shadow-none md:text-xl dark:bg-card disabled:cursor-default disabled:resize-none disabled:border-transparent disabled:bg-muted/60 disabled:opacity-100 dark:disabled:bg-muted/60";

/** The right answer beside a wrong part (a gap, a slot), once checked: "→ kurz". */
export function RightAnswer({ text, className }: { text: string; className?: string }) {
  const lang = useTargetLang();
  return (
    <span lang={lang} className={cn("ml-2 text-base text-wrong", className)}>
      → {text}
    </span>
  );
}

/** Options that are all pictures are laid out as a grid of equal tiles. */
export const allPictures = (options: Option[]) => options.every((o) => o.media?.image);

export function OptionButton({
  option,
  url,
  selected,
  mark,
  disabled,
  onClick,
  multi = false,
  fill = false,
}: {
  option: ShownOption;
  url(path: string): string;
  selected: boolean;
  mark: Mark;
  disabled: boolean;
  onClick(): void;
  /** Several can be chosen: a square box shows the choice. */
  multi?: boolean;
  fill?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // On a phone options that wrap share their row, so a list of long ones is not ragged; a
        // word longer than the screen breaks ("Oberbürgermeisterin/Oberbürgermeister").
        "relative flex min-h-12 max-w-full items-center gap-2 rounded-xl border-2 bg-card px-4 py-2 text-left text-lg transition [overflow-wrap:anywhere] max-sm:flex-auto",
        fill && "flex-col items-stretch px-2",
        !disabled && "hover:border-primary/60",
        selected && "border-primary bg-accent",
        mark === "correct" && "border-correct bg-correct-soft",
        mark === "wrong" && "border-wrong bg-wrong-soft",
        mark === "missed" && "border-dashed border-correct",
      )}
    >
      {multi && (
        <span
          aria-hidden
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-[5px] border-2",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
            fill && "absolute top-2 left-2 bg-card",
          )}
        >
          {selected && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      )}
      <OptionContent option={option} url={url} fill={fill} />
      {(mark === "correct" || mark === "missed") && (
        <Check className="size-5 shrink-0 text-correct" aria-hidden />
      )}
      {mark === "wrong" && <X className="size-5 shrink-0 text-wrong" aria-hidden />}
    </button>
  );
}

/**
 * Number keys 1–9 choose an option of the active item (desktop). Ignored while typing in a field and
 * with a modifier held.
 */
export function useNumberKeys(enabled: boolean, count: number, choose: (index: number) => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Not while typing, with a modifier, or behind an open panel (reference, tutor).
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (target.closest("input, textarea, select, [role=dialog]")) return;
      if (document.querySelector("[role=dialog]")) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > Math.min(count, 9)) return;
      e.preventDefault();
      choose(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

/** The capital of a letter; ß has its own (ẞ), not "SS". */
const capital = (letter: string, lang: string) =>
  letter === "ß" ? "ẞ" : letter.toLocaleUpperCase(lang);

/** Letters a keyboard may lack, per language being learnt (a Shift-click types the capital). */
const SPECIAL: Record<string, string[]> = { de: ["ä", "ö", "ü", "ß"] };

/**
 * A row of the language's special letters under text fields: a tap types the letter where the cursor
 * is in the field last focused inside `scope` (or its first field).
 */
export function SpecialLetters({ scope }: { scope: React.RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const letters = lang ? SPECIAL[lang] : undefined;
  if (!lang || !letters) return null;
  const type = (letter: string) => {
    const root = scope.current;
    if (!root) return;
    const focused = document.activeElement;
    const field = (
      focused instanceof HTMLElement && root.contains(focused) && focused.matches("input, textarea")
        ? focused
        : root.querySelector("input:not(:disabled), textarea:not(:disabled)")
    ) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const value = field.value.slice(0, start) + letter + field.value.slice(end);
    // Through the native setter, so React sees the change as typing.
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    field.setSelectionRange(start + letter.length, start + letter.length);
  };
  return (
    <fieldset className="flex flex-wrap gap-1.5">
      <legend className="sr-only">{t("ex.specialLetters")}</legend>
      {letters.map((letter) => (
        <button
          type="button"
          key={letter}
          lang={lang}
          // Keeps the cursor in the field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => type(e.shiftKey ? capital(letter, lang) : letter)}
          className="min-h-11 min-w-11 rounded-lg border bg-card px-2 text-lg hover:border-primary/60"
        >
          {letter}
        </button>
      ))}
    </fieldset>
  );
}

/** A pick from a short list inside an exercise (a gap, the right side of a pair): the app's select,
 *  sized for touch, with the item's state as its border. */
export function PickSelect({
  value,
  options,
  placeholder,
  label,
  disabled,
  className,
  onChange,
}: {
  value: string | undefined;
  options: Array<{ id: string; text: string }>;
  placeholder: string;
  label: string;
  disabled?: boolean;
  /** State classes (border colours) and width. */
  className?: string;
  onChange(id: string): void;
}) {
  const lang = useTargetLang();
  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-11 rounded-lg border-2 bg-card text-lg data-[size=default]:h-11",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id} className="text-lg" lang={lang}>
            {o.text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
