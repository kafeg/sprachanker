import { correctOptions, type Outcome } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useShuffled } from "./shared.tsx";
import type { ItemOf, RendererProps } from "./types.ts";

type Segments = ItemOf<"gap_text">["segments"];

/** 1-based position of a gap in the text, for its accessible name. */
const gapNumber = (segments: Segments, gap: string) =>
  segments.filter((s) => typeof s !== "string").findIndex((s) => s.gap === gap) + 1;

function Text({ segments, gap }: { segments: Segments; gap(id: string): React.ReactNode }) {
  const lang = useTargetLang();
  return (
    <p lang={lang} className="whitespace-pre-wrap text-xl leading-[2.6]">
      {segments.map((s, i) =>
        typeof s === "string" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are static
          <span key={i}>{s}</span>
        ) : (
          <span key={s.gap} className="mx-1 inline-block align-baseline">
            {gap(s.gap)}
          </span>
        ),
      )}
    </p>
  );
}

const fieldMark = (outcome: Outcome | undefined, ok: boolean) =>
  outcome ? (ok ? "border-correct bg-correct-soft" : "border-wrong bg-wrong-soft") : "border-input";

export function GapChoice({ item, answer, onAnswer, outcome }: RendererProps<"gap_choice">) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const values = answer ?? {};
  const set = (gap: string, id: string) => onAnswer({ ...values, [gap]: id });
  const textOf = (gap: string, id?: string) =>
    item.gaps[gap]?.options.find((o) => o.id === id)?.text;
  const right = (gap: string) => correctOptions(item.answer[gap]);
  const ok = (gap: string) =>
    !!values[gap] && right(gap).some((id) => textOf(gap, values[gap]) === textOf(gap, id));
  const rightText = (gap: string) =>
    right(gap)
      .map((id) => textOf(gap, id))
      .join(" / ");
  const bank = useShuffled(Object.values(item.gaps)[0]?.options ?? [], item.key);

  if (item.display === "bank") {
    const used = new Set(Object.values(values));
    const next = Object.keys(item.gaps).find((g) => !values[g]);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {bank.map((o) => (
            <button
              type="button"
              key={o.id}
              disabled={used.has(o.id) || !!outcome || !next}
              onClick={() => next && set(next, o.id)}
              className={cn(
                "rounded-full border-2 bg-card px-4 py-1.5 text-lg",
                used.has(o.id) && "opacity-30",
              )}
            >
              <span lang={lang}>{o.text}</span>
            </button>
          ))}
        </div>
        <Text
          segments={item.segments}
          gap={(gap) => (
            <button
              type="button"
              disabled={!!outcome}
              onClick={() => {
                const { [gap]: _, ...rest } = values;
                onAnswer(rest);
              }}
              className={cn(
                "inline-flex h-11 min-w-24 items-center justify-center rounded-lg border-2 border-dashed px-3 text-lg",
                values[gap] && "border-solid",
                fieldMark(outcome, ok(gap)),
              )}
            >
              {textOf(gap, values[gap]) ?? " "}
              {outcome && !ok(gap) && (
                <span className="ml-2 text-base text-wrong">→ {rightText(gap)}</span>
              )}
            </button>
          )}
        />
      </div>
    );
  }

  return (
    <Text
      segments={item.segments}
      gap={(gap) => (
        <>
          <select
            value={values[gap] ?? ""}
            aria-label={t("ex.gap", { n: gapNumber(item.segments, gap) })}
            disabled={!!outcome}
            onChange={(e) => set(gap, e.target.value)}
            className={cn(
              "h-11 rounded-lg border-2 bg-card px-2 text-lg",
              fieldMark(outcome, ok(gap)),
            )}
          >
            <option value="">…</option>
            {(item.gaps[gap]?.options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.text}
              </option>
            ))}
          </select>
          {outcome && !ok(gap) && (
            <span className="ml-1 text-base text-wrong">{rightText(gap)}</span>
          )}
        </>
      )}
    />
  );
}

export function GapText({ item, answer, onAnswer, outcome }: RendererProps<"gap_text">) {
  const { t } = useTranslation();
  const values = answer ?? {};
  return (
    <Text
      segments={item.segments}
      gap={(gap) => {
        const accepted = item.answer[gap]?.accepted ?? [];
        const ok = outcome?.result === "correct";
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
              style={{ width: `${Math.max(6, (accepted[0]?.length ?? 6) + 2)}ch` }}
              className={cn(
                "h-11 rounded-lg border-2 bg-card px-2 text-lg",
                fieldMark(outcome, ok),
              )}
            />
            {outcome && !ok && (
              <span className="ml-1 text-base text-wrong">
                {accepted.map((a) => a || "—").join(" / ")}
              </span>
            )}
          </>
        );
      }}
    />
  );
}
