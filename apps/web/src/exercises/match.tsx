// match: pair the entries of two sides. One side gives slots, the other chips placed into them by drag
// or tap (dnd.tsx). Pictures make the slots (each picture with a slot under it, the words as chips);
// otherwise the left entries are rows with a slot and the right ones the chips. Answers are always
// pairs [left, right].
import type { Option } from "@sprachanker/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { Chip, DragBoard, Slot } from "./dnd.tsx";
import { partRight, RightAnswer, TILE, TILES, useShuffled } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

const hasImage = (options: Option[]) => options.some((o) => o.media?.image);

export function Match({ item, answer, onAnswer, outcome, url }: RendererProps<"match">) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const [picked, setPicked] = useState<string>();
  // Pictures on the right become the slots; the words on the left the chips.
  const flip = hasImage(item.right) && !hasImage(item.left);
  const shuffledRight = useShuffled(item.right, item.key);
  const shuffledLeft = useShuffled(item.left, `${item.key}:left`);
  const slots = flip ? shuffledRight : item.left;
  const chips = flip ? shuffledLeft : shuffledRight;
  const toSlot = (pair: [string, string]) => (flip ? [pair[1], pair[0]] : pair) as [string, string];
  const placed = new Map((answer?.pairs ?? []).map((p) => toSlot(p)));
  const wanted = new Map(item.answer.pairs.map((p) => toSlot(p)));
  const used = new Set(placed.values());
  const textOf = (id: string | undefined) => chips.find((c) => c.id === id)?.text;
  // The engine marks each pair by its left side.
  const right = (slot: string) => partRight(outcome, flip ? (wanted.get(slot) ?? "") : slot);

  const commit = (next: Map<string, string>) =>
    onAnswer({
      pairs: [...next].map(([slot, chip]) => (flip ? [chip, slot] : [slot, chip])) as Array<
        [string, string]
      >,
    });
  const place = (chip: string, slot: string) => {
    const next = new Map([...placed].filter(([, c]) => c !== chip));
    next.set(slot, chip);
    commit(next);
    setPicked(undefined);
  };
  const tapSlot = (slot: string) => {
    if (picked) return place(picked, slot);
    if (!placed.has(slot)) return;
    const next = new Map(placed);
    next.delete(slot);
    commit(next);
  };

  const chipView = (o: Option) =>
    o.media?.image ? (
      <img src={url(o.media.image)} alt="" className="h-16 w-auto rounded-lg" />
    ) : (
      <span lang={lang}>{o.text}</span>
    );
  const slotContent = (slot: string) => {
    const chip = chips.find((c) => c.id === placed.get(slot));
    return chip ? chipView(chip) : <span className="text-base">{t("ex.dropHere")}</span>;
  };
  const correction = (slot: string) =>
    outcome && !right(slot) ? (
      <RightAnswer text={textOf(wanted.get(slot)) ?? ""} className="ml-0 text-sm" />
    ) : null;
  const slotProps = (slot: Option, n: number) => ({
    id: slot.id,
    label: t("ex.matchFor", { n }),
    filled: placed.has(slot.id),
    active: !!picked,
    mark: outcome ? (right(slot.id) ? ("correct" as const) : ("wrong" as const)) : undefined,
    disabled: !!outcome,
    onTap: () => tapSlot(slot.id),
  });

  return (
    <DragBoard onDrop={place}>
      <div className="space-y-4">
        {!outcome && (
          <fieldset className="flex min-h-11 flex-wrap gap-2">
            <legend className="sr-only">{t("ex.chips")}</legend>
            {chips
              .filter((c) => !used.has(c.id))
              .map((c) => (
                <Chip
                  key={c.id}
                  id={c.id}
                  label={c.text}
                  selected={picked === c.id}
                  onTap={() => setPicked(picked === c.id ? undefined : c.id)}
                >
                  {chipView(c)}
                </Chip>
              ))}
          </fieldset>
        )}
        {flip ? (
          <div className={TILES}>
            {slots.map((s, i) => (
              <div key={s.id} className={cn(TILE, "space-y-1.5")}>
                {s.media?.image && (
                  <img src={url(s.media.image)} alt="" className="w-full rounded-xl object-cover" />
                )}
                {/* A tile's slot is narrow on a phone: smaller type, so a short phrase ("die
                    Kreuzung") keeps to one line beside its mark. */}
                <Slot {...slotProps(s, i + 1)} className="w-full px-2 text-base sm:text-lg">
                  {slotContent(s.id)}
                </Slot>
                {correction(s.id)}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {slots.map((s, i) => (
              // On a phone the entry above its slot, the slot the row's width; side by side wider.
              <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span lang={lang} className="text-lg font-semibold max-sm:w-full sm:min-w-32">
                  {chipView(s)}
                </span>
                <span aria-hidden className="max-sm:hidden">
                  →
                </span>
                <Slot {...slotProps(s, i + 1)} className="max-sm:w-full sm:min-w-40">
                  {slotContent(s.id)}
                </Slot>
                {correction(s.id)}
              </div>
            ))}
          </div>
        )}
      </div>
    </DragBoard>
  );
}
