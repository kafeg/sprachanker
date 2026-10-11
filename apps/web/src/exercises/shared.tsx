import type { LocaleItem, Option, Outcome } from "@sprachanker/schema";
import { Check, ChevronDown, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { inLang } from "@/ui/direction.tsx";
import { keptTogether } from "@/ui/line-breaks.ts";
import { useCoarsePointer } from "@/ui/pointer.ts";
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

/** A multiple choice's "several can be right" is said above the items (or by the exercise): not in
 *  each card. */
export const SeveralSaid = createContext(false);

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

/** What tells an option apart in its order: its text, else its picture, else its id. */
const optionName = (o: ShownOption) => o.text ?? o.learnerText ?? o.media?.image ?? o.id;

/**
 * A choice's options in the order shown in a pass: shuffled, one order for every item of the exercise
 * with the same options (Richtig/Falsch keep their places from item to item), a sequence — every
 * option a number ("1", "8 Uhr") — in its own order. Pure.
 */
export function optionOrder(options: ShownOption[], itemKey: string, pass: string): ShownOption[] {
  if (options.every((o) => /^\s*\d/.test(optionName(o)))) return options;
  const byName = [...options].sort((a, b) => optionName(a).localeCompare(optionName(b)));
  const exercise = itemKey.split("#")[0];
  return shuffled(byName, `${pass}:${exercise}:${byName.map(optionName).join("|")}`);
}

/** `optionOrder` in the pass shown (the source's order within an exam). */
export function useOptionOrder(options: ShownOption[], itemKey: string): ShownOption[] {
  const pass = useContext(ShuffleSeed);
  const keep = useContext(SourceOrder);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reordered only for another item or pass
  return useMemo(
    () => (keep ? options : optionOrder(options, itemKey, pass)),
    [pass, itemKey, keep],
  );
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

/** A prompt of numbered tasks run on in one line ("1. … 2. …"): each task on its own line, as the
 *  answers under it are. Only a text that begins with "1." and goes on with 2, 3… in turn. Pure. */
export function numberedLines(text: string): string {
  if (!/^\s*1\.\s/.test(text)) return text;
  let next = 2;
  return text.replace(/\s+(\d+)\.\s/g, (run, n: string) => {
    if (Number(n) !== next) return run;
    next++;
    return `\n${n}. `;
  });
}

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
          // A tile's picture keeps its own shape: no empty band above or under it.
          fill ? "h-auto max-h-64 w-full object-contain" : "h-28 w-auto sm:h-32",
        )}
      />
    );
    // A picture with its own label (an exam's "a", "b", or a word under it): both shown.
    if (option.text === undefined) return picture;
    return (
      <span className="flex flex-col items-center gap-1">
        {picture}
        <span {...inLang(lang)} className="text-base">
          {keptTogether(option.text)}
        </span>
      </span>
    );
  }
  // The learner's language is the page's: no `lang` of the target's on it.
  if (option.text === undefined && option.learnerText !== undefined)
    return <span>{keptTogether(option.learnerText)}</span>;
  return <span {...inLang(lang)}>{option.text && keptTogether(option.text)}</span>;
}

/** A written answer's box (dictation, respond) over the ui Textarea: large type, it grows with the
 *  text; once checked it reads as the answer given, not as a field. */
export const ANSWER_BOX =
  "min-h-20 rounded-xl border-2 bg-card p-3 text-xl shadow-none md:text-xl dark:bg-card disabled:cursor-default disabled:resize-none disabled:border-transparent disabled:bg-muted/60 disabled:opacity-100 dark:disabled:bg-muted/60";

/** The right answer beside a wrong part (a gap, a slot), once checked: "→ kurz" (the arrow never
 *  alone at a line's end). */
export function RightAnswer({ text, className }: { text: string; className?: string }) {
  const lang = useTargetLang();
  return (
    <span {...inLang(lang)} className={cn("ms-2 text-base text-wrong", className)}>
      {`→\u00a0${text}`}
    </span>
  );
}

/** A gap once checked: the answer given as text in its frame — not a greyed field — with ✓ or ✕. */
export function CheckedField({ text, ok }: { text: string | undefined; ok: boolean }) {
  const lang = useTargetLang();
  const { t, i18n } = useTranslation();
  return (
    <span
      {...inLang(lang)}
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border-2 px-3 text-lg",
        ok ? "border-correct bg-correct-soft" : "border-wrong bg-wrong-soft",
      )}
    >
      <span className="min-w-0 text-balance">{text || "\u00a0"}</span>
      {ok ? (
        <Check className="size-4 shrink-0 text-correct" aria-hidden />
      ) : (
        <X className="size-4 shrink-0 text-wrong" aria-hidden />
      )}
      {/* The mark in words for screen readers, in the learner's language. */}
      <span className="sr-only" lang={i18n.language}>
        {` ${t(ok ? "ex.partRight" : "ex.partWrong")}`}
      </span>
    </span>
  );
}

/** Options that are all pictures are laid out as tiles. */
export const allPictures = (options: Option[]) => options.every((o) => o.media?.image);

/** Tiles (pictures): one width, two to a row on a phone and three wider; a last row short of tiles
 *  is centred (no tile alone at half width on the left). `TILES` on the row, `TILE` on each. */
export const TILES = "flex flex-wrap justify-center gap-3";
export const TILE =
  "min-w-0 shrink-0 grow-0 basis-[calc((100%_-_0.75rem)/2)] sm:basis-[calc((100%_-_1.5rem)/3)]";

/** A tile's mark in its corner: no row of its own under the picture. */
const MARK_CORNER = "absolute top-2 end-2 box-content rounded-full bg-card p-0.5";
/** A text option's mark at its right edge, in the room it keeps for it. */
const MARK_END = "absolute top-1/2 end-4 -translate-y-1/2";

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
        // A word longer than the screen breaks ("Oberbürgermeisterin/Oberbürgermeister").
        "relative flex min-h-12 max-w-full items-center gap-2 rounded-xl border-2 bg-card px-4 py-2 text-start text-lg text-pretty transition [overflow-wrap:anywhere]",
        // A text option has its row and keeps room for its mark: checking moves nothing.
        fill ? cn(TILE, "flex-col items-stretch justify-center px-2") : "w-full pe-11",
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
            fill && "absolute top-2 start-2",
            // On a picture an empty box has a ground of its own; a ticked one keeps its fill.
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : cn("border-input", fill && "bg-card"),
          )}
        >
          {selected && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      )}
      <OptionContent option={option} url={url} fill={fill} />
      {(mark === "correct" || mark === "missed") && (
        <Check
          className={cn("size-5 shrink-0 text-correct", fill ? MARK_CORNER : MARK_END)}
          aria-hidden
        />
      )}
      {mark === "wrong" && (
        <X
          className={cn("size-5 shrink-0 text-wrong", fill ? MARK_CORNER : MARK_END)}
          aria-hidden
        />
      )}
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
          {...inLang(lang)}
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

/** A pick from a short list inside an exercise (a gap): the app's list with a mouse; on a touch
 *  screen the system's own picker (a native select), which one tap opens on iOS and Android alike. */
export function PickSelect({
  value,
  options,
  placeholder,
  label,
  className,
  onChange,
}: {
  value: string | undefined;
  options: Array<{ id: string; text: string }>;
  placeholder: string;
  label: string;
  /** Its width. */
  className?: string;
  onChange(id: string): void;
}) {
  const lang = useTargetLang();
  const coarse = useCoarsePointer();
  const field = "h-11 rounded-lg border-2 border-input bg-card text-lg";
  if (coarse)
    return (
      <span className={cn("relative inline-flex max-w-full", className)}>
        <select
          aria-label={label}
          {...inLang(lang)}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            field,
            "min-w-0 grow appearance-none truncate pe-9 ps-3 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            !value && "text-muted-foreground",
          )}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.text}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 end-3 size-4 -translate-y-1/2 opacity-50"
        />
      </span>
    );
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(field, "max-w-full data-[size=default]:h-11", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id} className="text-lg" {...inLang(lang)}>
            {o.text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
