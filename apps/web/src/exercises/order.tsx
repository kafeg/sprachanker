// order: put the parts in order. A tap adds a part to the line, a tap in the line takes it back; or drag
// a part into the line, onto a part in it (it goes there) or back to the pool (dnd.tsx).
import type { Option } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { cn } from "@/ui/utils.ts";
import { Chip, DragBoard, Zone } from "./dnd.tsx";
import { OptionContent, useShuffled } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

const LINE = "order:line";
const POOL = "order:pool";
const AT = "order:at:";
// A part is in the line and (faded) in the pool at once: its two chips need their own drag ids.
const IN = "order:in:";
const OUT = "order:out:";

export function Order({ item, answer, onAnswer, outcome, url }: RendererProps<"order">) {
  const { t } = useTranslation();
  const pool = useShuffled(item.parts, item.key);
  const sequence: string[] = answer?.sequence ?? [];
  const byId = (id: string) => item.parts.find((p) => p.id === id) as Option;
  const set = (next: string[]) => onAnswer({ sequence: next });

  const drop = (dragged: string, target: string) => {
    const chip = dragged.slice((dragged.startsWith(IN) ? IN : OUT).length);
    const rest = sequence.filter((id) => id !== chip);
    if (target === POOL) return set(rest);
    if (target === LINE) return set([...rest, chip]);
    const on = target.slice(AT.length);
    if (on === chip) return;
    // Moved forward along the line it goes after the part it was dropped on, otherwise before it.
    const from = sequence.indexOf(chip);
    const at = rest.indexOf(on) + (from !== -1 && from < sequence.indexOf(on) ? 1 : 0);
    set([...rest.slice(0, at), chip, ...rest.slice(at)]);
  };

  return (
    <DragBoard onDrop={drop}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("ex.orderHint")}</p>
        <Zone
          id={LINE}
          label={t("ex.orderLine")}
          className={cn(
            "flex min-h-14 flex-wrap items-center gap-2 rounded-xl border-2 border-dashed p-2",
            outcome?.result === "correct" && "border-correct bg-correct-soft",
            outcome && outcome.result !== "correct" && "border-wrong bg-wrong-soft",
          )}
        >
          {sequence.map((id, i) => (
            <Chip
              key={id}
              id={`${IN}${id}`}
              label={byId(id).text}
              dropId={`${AT}${id}`}
              disabled={!!outcome}
              className="border-primary"
              onTap={() => set(sequence.filter((_, j) => j !== i))}
            >
              <OptionContent option={byId(id)} url={url} />
            </Chip>
          ))}
        </Zone>
        <Zone id={POOL} label={t("ex.chips")} className="flex min-h-11 flex-wrap gap-2 rounded-xl">
          {pool.map((p) => {
            const used = sequence.includes(p.id);
            return (
              <Chip
                key={p.id}
                id={`${OUT}${p.id}`}
                label={p.text}
                disabled={used || !!outcome}
                className={cn(used && "opacity-30", !used && !outcome && "hover:border-primary/60")}
                onTap={() => set([...sequence, p.id])}
              >
                <OptionContent option={p} url={url} />
              </Chip>
            );
          })}
        </Zone>
        {!outcome && sequence.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => set([])}>
            {t("ex.reset")}
          </Button>
        )}
      </div>
    </DragBoard>
  );
}
