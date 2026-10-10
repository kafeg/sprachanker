import { correctOptions, type Option, type Outcome } from "@sprachanker/schema";
import { useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { Chip, DragBoard, Slot } from "./dnd.tsx";
import {
  PickSelect,
  partRight,
  RightAnswer,
  ShuffleSeed,
  SpecialLetters,
  shuffled,
  useShuffled,
} from "./shared.tsx";
import type { ItemOf, RendererProps } from "./types.ts";

type Segments = ItemOf<"gap_text">["segments"];

/** 1-based position of a gap in the text, for its accessible name. */
const gapNumber = (segments: Segments, gap: string) =>
  segments.filter((s) => typeof s !== "string").findIndex((s) => s.gap === gap) + 1;

function Text({ segments, gap }: { segments: Segments; gap(id: string): React.ReactNode }) {
  const lang = useTargetLang();
  return (
    // Lines keep the text's own spacing; a line with a gap grows around it (a long dialogue with a
    // few gaps is not spread out over the screen).
    <p lang={lang} className="whitespace-pre-wrap text-xl leading-relaxed">
      {segments.map((s, i) =>
        typeof s === "string" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are static
          <span key={i}>{s}</span>
        ) : (
          <span key={s.gap} className="mx-1 my-1 inline-block align-baseline">
            {gap(s.gap)}
          </span>
        ),
      )}
    </p>
  );
}

const fieldMark = (outcome: Outcome | undefined, ok: boolean) =>
  outcome ? (ok ? "border-correct bg-correct-soft" : "border-wrong bg-wrong-soft") : "border-input";

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
                <span lang={lang}>{o.text}</span>
              </Chip>
            ))}
          </fieldset>
        )}
        <Text
          segments={item.segments}
          gap={(gap) => (
            <>
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
                className="inline-flex min-w-24 align-baseline"
              >
                <span lang={lang}>{textOf(gap, values[gap]) ?? "\u00a0"}</span>
              </Slot>
              {outcome && !ok(gap) && <RightAnswer text={rightText(gap)} />}
            </>
          )}
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
    item.gaps[gap]?.options.find((o) => o.id === id)?.text;
  const right = (gap: string) => correctOptions(item.answer[gap]);
  const ok = (gap: string) => partRight(outcome, gap);
  const rightText = (gap: string) =>
    right(gap)
      .map((id) => textOf(gap, id))
      .join(" / ");
  const bank = useShuffled(Object.values(item.gaps)[0]?.options ?? [], item.key);
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
      gap={(gap) => (
        <>
          <PickSelect
            value={values[gap]}
            options={shuffled(item.gaps[gap]?.options ?? [], `${pass}:${item.key}:${gap}`).map(
              (o) => ({ id: o.id, text: o.text ?? "" }),
            )}
            placeholder="…"
            label={t("ex.gap", { n: gapNumber(item.segments, gap) })}
            disabled={!!outcome}
            onChange={(id) => set(gap, id)}
            className={cn("inline-flex min-w-20 align-middle", fieldMark(outcome, ok(gap)))}
          />
          {outcome && !ok(gap) && <RightAnswer text={rightText(gap)} />}
        </>
      )}
    />
  );
}

export function GapText({ item, answer, onAnswer, outcome }: RendererProps<"gap_text">) {
  const { t } = useTranslation();
  const values = answer ?? {};
  const scope = useRef<HTMLDivElement>(null);
  return (
    <div ref={scope} className="space-y-2">
      <Text
        segments={item.segments}
        gap={(gap) => {
          const accepted = item.answer[gap]?.accepted ?? [];
          const ok = partRight(outcome, gap);
          return (
            <>
              <input
                value={values[gap] ?? ""}
                disabled={!!outcome}
                aria-label={t("ex.gap", { n: gapNumber(item.segments, gap) })}
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => onAnswer({ ...values, [gap]: e.target.value })}
                // Grows with what is typed: its width gives nothing of the answer away.
                style={{ width: `${Math.max(6, (values[gap]?.length ?? 0) + 2)}ch` }}
                className={cn(
                  "h-11 rounded-lg border-2 bg-card px-2 text-lg",
                  fieldMark(outcome, ok),
                )}
              />
              {outcome && !ok && <RightAnswer text={accepted.map((a) => a || "—").join(" / ")} />}
            </>
          );
        }}
      />
      {!outcome && <SpecialLetters scope={scope} />}
    </div>
  );
}
