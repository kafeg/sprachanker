import { correctOptions, type ItemOf, type Option } from "@sprachanker/schema";
import { createContext, useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { inLang } from "@/ui/direction.tsx";
import { keptTogether } from "@/ui/line-breaks.ts";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { Chip, DragBoard, Slot } from "./dnd.tsx";
import {
  CheckedField,
  PickSelect,
  partRight,
  RightAnswer,
  ShuffleSeed,
  SourceOrder,
  SpecialLetters,
  shuffled,
  useShuffled,
} from "./shared.tsx";
import type { RendererProps } from "./types.ts";

type Segments = ItemOf<"gap_text">["segments"];

/** 1-based position of a gap in the text, for its accessible name. */
const gapNumber = (segments: Segments, gap: string) =>
  segments.filter((s) => typeof s !== "string").findIndex((s) => s.gap === gap) + 1;

/**
 * What follows a gap and stays with it: closing punctuation touching it, a full stop or comma after
 * a space too (the space dropped: "[gap] ." reads "[gap]."), letters or a hyphen touching it
 * ("[gap]'s", "[gap]en", "[gap]-Kurs"). An ellipsis or an opening quote after a space stays apart (" …und", ' "Max"').
 */
const TAIL =
  /^(?:[ \u00a0]*[.,]|[!?;:…)\]»“”"])[.,!?;:…)\]»“”"]*|^['’\p{L}\p{N}‐‑-]+[.,!?;:…)\]»“”"]*/u;

/** What stays with a gap before it: what touches it — a word's stem ("mein[em]"), a quote
 *  ("„[gap]") —, or an article and its space ("die [gap]": never "die" alone at a line's end). */
const HEAD = /\S+$|(?<!\p{L})(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines) $/iu;

/** A run of a gap text: words between gaps, or a gap with what touches it on either side. */
export type Run = { text: string } | { gap: string; head: string; tail: string };

/** A gap text as runs: what touches a gap goes with it, so no line breaks between them. Pure. */
export function runs(segments: Segments): Run[] {
  const out: Run[] = [];
  let head = "";
  for (const [i, s] of segments.entries()) {
    if (typeof s !== "string") {
      out.push({ gap: s.gap, head, tail: "" });
      head = "";
      continue;
    }
    let text = s;
    const last = out.at(-1);
    if (last && "gap" in last) {
      const tail = text.match(TAIL)?.[0] ?? "";
      last.tail = tail.trim();
      // The space after a gap is its unit's margin: a line broken there starts with the word.
      text = text.slice(tail.length).replace(/^ /, "");
    }
    head = typeof segments[i + 1] === "object" ? (text.match(HEAD)?.[0] ?? "") : "";
    text = text.slice(0, text.length - head.length);
    if (text) out.push({ text });
  }
  return out;
}

/** The text's mark after a gap whose answer ends with that same mark: once ("Bin schon da." + "."
 *  reads "da.", not "da.."). Shown so only; the answer stays as given. Pure. */
export const tailAfter = (tail: string, shown = "") =>
  /^[.!?…]/.test(tail) && shown.trimEnd().endsWith(tail.charAt(0)) ? tail.slice(1) : tail;

/** A gap as shown: its field (`shown`: its text) and, once checked and wrong, the right answer
 *  under it. */
type ShownGap = { field: React.ReactNode; shown?: string; right?: string };

function Text({ segments, gap }: { segments: Segments; gap(id: string): ShownGap }) {
  const lang = useTargetLang();
  return (
    // Lines keep the text's own spacing; a line with a gap grows around it (a long dialogue with a
    // few gaps is not spread out over the screen).
    <p {...inLang(lang)} className="whitespace-pre-wrap text-xl leading-relaxed">
      {runs(segments).map((run, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are static
        if ("text" in run) return <span key={i}>{keptTogether(run.text)}</span>;
        const { field, shown, right } = gap(run.gap);
        const tail = tailAfter(run.tail, shown);
        return (
          // The gap with what touches it is one unit that never breaks — the stem or quote before
          // it, the punctuation after it; the right answer sits under the gap, not between them.
          <span
            key={run.gap}
            className={cn(
              "my-1 inline-flex max-w-full items-baseline align-baseline",
              run.head ? "me-1" : "mx-1",
            )}
          >
            {run.head && <span>{run.head.trimEnd()}</span>}
            <span
              className={cn(
                "inline-flex min-w-0 flex-col items-start",
                // An article's space as a margin (a space at a flex item's end may not show).
                run.head && (run.head.endsWith(" ") ? "ms-[0.3em]" : "ms-0.5"),
              )}
            >
              {field}
              {right !== undefined && <RightAnswer text={right} className="ms-0 text-sm" />}
            </span>
            {tail && <span>{tail}</span>}
          </span>
        );
      })}
    </p>
  );
}

/** The room of an exam's typed gaps in `ch`: all alike, whatever the answer (an exam tells nothing). */
export const EXAM_GAP_ROOM = 16;

/**
 * The room every typed gap of an exercise has, in `ch`: the longest accepted answer of any of its gaps,
 * rounded up to a step of four, at least eight — one width for all its gaps, so a gap's width says
 * nothing of its own answer ("du" and "ich" alike). Pure.
 */
export const gapRoom = (items: Array<ItemOf<"gap_text">>) => {
  const longest = Math.max(
    0,
    ...items
      .flatMap((item) => Object.values(item.answer).flatMap((a) => a.accepted))
      .map((a) => a.length),
  );
  return Math.max(8, Math.ceil((longest + 2) / 4) * 4);
};

/** The room its exercise gives a typed gap (`gapRoom`, set by the item's card; an exam's
 *  `EXAM_GAP_ROOM`); without one, its own item's. */
export const GapRoom = createContext<number | undefined>(undefined);

/** What a typed gap holds when it is no word (a number, a price, a time, as AI practice asks one):
 *  said in it ("in digits"), and no row of the language's letters under it. */
export const GapDigits = createContext<string | undefined>(undefined);

/** A typed gap's width in `ch`: its room, and more as what is typed outgrows it. Pure. */
export const gapWidth = (room: number, typed = "") => Math.max(room, typed.length + 2);

/** An option that is only a dash: no word in the gap. */
const NOTHING = /^\s*[-–—]\s*$/;

const WORD = "bank:word:";
const GAP = "bank:gap:";

/**
 * The words above the text fill its gaps: one gap is active (the first empty one, or the one tapped)
 * and a tapped word goes there; a word can also be dragged onto any gap. A tap on a filled gap takes
 * its word back and makes that gap active.
 */
function WordBank({
  item,
  values,
  onAnswer,
  outcome,
  bank,
  textOf,
  ok,
  rightText,
}: Pick<RendererProps<"gap_choice">, "item" | "onAnswer" | "outcome"> & {
  values: Record<string, string>;
  bank: Option[];
  textOf(gap: string, id?: string): string | undefined;
  ok(gap: string): boolean;
  rightText(gap: string): string;
}) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const gaps = Object.keys(item.gaps);
  const [chosen, setChosen] = useState<string>();
  const active = outcome
    ? undefined
    : chosen && !values[chosen]
      ? chosen
      : gaps.find((g) => !values[g]);
  const used = new Set(Object.values(values));
  const room = Math.max(4, ...bank.map((o) => o.text?.length ?? 0));
  const place = (gap: string, word: string) => {
    // A word sits in one gap at a time.
    const rest = Object.fromEntries(Object.entries(values).filter(([, w]) => w !== word));
    onAnswer({ ...rest, [gap]: word });
    setChosen(undefined);
  };
  return (
    <DragBoard onDrop={(word, gap) => place(gap.slice(GAP.length), word.slice(WORD.length))}>
      <div className="space-y-4">
        {/* Once checked, no bank: the text with its words and the right ones is what is left. */}
        {!outcome && (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t("ex.chips")}</legend>
            {bank.map((o) => (
              <Chip
                key={o.id}
                id={`${WORD}${o.id}`}
                label={o.text}
                disabled={used.has(o.id)}
                className={cn(used.has(o.id) && "opacity-30")}
                onTap={() => active && place(active, o.id)}
              >
                <span {...inLang(lang)}>{o.text}</span>
              </Chip>
            ))}
          </fieldset>
        )}
        <Text
          segments={item.segments}
          gap={(gap) => ({
            field: (
              <Slot
                id={`${GAP}${gap}`}
                label={t("ex.gap", { n: gapNumber(item.segments, gap) })}
                filled={!!values[gap]}
                active={gap === active}
                mark={outcome ? (ok(gap) ? "correct" : "wrong") : undefined}
                disabled={!!outcome}
                onTap={() => {
                  const { [gap]: _, ...rest } = values;
                  if (values[gap]) onAnswer(rest);
                  setChosen(gap);
                }}
                // Every slot of the text one width at least: the longest word of the bank and its
                // mark; a word wider than that in its letters widens its slot rather than breaking
                // inside it ("Du / kommst"), wrapping only past the line's width.
                style={{ minWidth: `min(100%, calc(${room}ch + 3.25rem))` }}
                className="inline-flex max-w-full align-baseline"
              >
                <span {...inLang(lang)}>{textOf(gap, values[gap]) ?? "\u00a0"}</span>
              </Slot>
            ),
            shown: textOf(gap, values[gap]),
            right: outcome && !ok(gap) ? rightText(gap) : undefined,
          })}
        />
      </div>
    </DragBoard>
  );
}

export function GapChoice({ item, answer, onAnswer, outcome }: RendererProps<"gap_choice">) {
  const { t } = useTranslation();
  const values = answer ?? {};
  const set = (gap: string, id: string) => onAnswer({ ...values, [gap]: id });
  const textOf = (gap: string, id?: string) =>
    shownOption(item.gaps[gap]?.options.find((o) => o.id === id)?.text);
  const right = (gap: string) => correctOptions(item.answer[gap]);
  const ok = (gap: string) => partRight(outcome, gap);
  const rightText = (gap: string) =>
    right(gap)
      .map((id) => textOf(gap, id))
      .join(" / ");
  // An option of only a dash is "no word here": said so.
  const shownOption = (text?: string) =>
    text !== undefined && NOTHING.test(text) ? t("ex.nothing") : text;
  const bank = useShuffled(Object.values(item.gaps)[0]?.options ?? [], item.key).map((o) => ({
    ...o,
    text: shownOption(o.text),
  }));
  const pass = useContext(ShuffleSeed);

  if (item.display === "bank")
    return (
      <WordBank
        item={item}
        values={values}
        onAnswer={onAnswer}
        outcome={outcome}
        bank={bank}
        textOf={textOf}
        ok={ok}
        rightText={rightText}
      />
    );

  return (
    <Text
      segments={item.segments}
      gap={(gap) => ({
        field: outcome ? (
          <CheckedField text={textOf(gap, values[gap])} ok={ok(gap)} />
        ) : (
          <PickSelect
            value={values[gap]}
            options={shuffled(item.gaps[gap]?.options ?? [], `${pass}:${item.key}:${gap}`).map(
              (o) => ({ id: o.id, text: shownOption(o.text) ?? "" }),
            )}
            placeholder="…"
            label={t("ex.gap", { n: gapNumber(item.segments, gap) })}
            onChange={(id) => set(gap, id)}
            className="min-w-20"
          />
        ),
        shown: textOf(gap, values[gap]),
        right: outcome && !ok(gap) ? rightText(gap) : undefined,
      })}
    />
  );
}

export function GapText({ item, answer, onAnswer, outcome }: RendererProps<"gap_text">) {
  const { t } = useTranslation();
  const values = answer ?? {};
  const scope = useRef<HTMLDivElement>(null);
  const exam = useContext(SourceOrder);
  const given = useContext(GapRoom);
  const digits = useContext(GapDigits);
  const room = exam ? EXAM_GAP_ROOM : (given ?? gapRoom([item]));
  return (
    <div ref={scope} className="space-y-2">
      <Text
        segments={item.segments}
        gap={(gap) => {
          const accepted = item.answer[gap]?.accepted ?? [];
          const ok = partRight(outcome, gap);
          return {
            field: outcome ? (
              <CheckedField text={values[gap]} ok={ok} />
            ) : (
              <input
                value={values[gap] ?? ""}
                aria-label={t("ex.gap", { n: gapNumber(item.segments, gap) })}
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                placeholder={digits}
                onChange={(e) => onAnswer({ ...values, [gap]: e.target.value })}
                style={{ width: `calc(${gapWidth(room, values[gap])}ch + 1.25rem)` }}
                className="h-11 max-w-full rounded-lg border-2 border-input bg-card px-2 text-lg"
              />
            ),
            shown: values[gap],
            right: outcome && !ok ? accepted.map((a) => a || "—").join(" / ") : undefined,
          };
        }}
      />
      {!outcome && !digits && <SpecialLetters scope={scope} />}
    </div>
  );
}
