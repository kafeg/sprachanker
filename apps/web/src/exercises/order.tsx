import type { Option } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { cn } from "@/ui/utils.ts";
import { OptionContent, useShuffled } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

export function Order({ item, answer, onAnswer, outcome, url }: RendererProps<"order">) {
  const { t } = useTranslation();
  const pool = useShuffled(item.parts, item.key);
  const sequence: string[] = answer?.sequence ?? [];
  const byId = (id: string) => item.parts.find((p) => p.id === id) as Option;
  const chip = "rounded-full border-2 bg-card px-4 py-1.5 text-lg transition";
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("ex.orderHint")}</p>
      <div
        className={cn(
          "flex min-h-14 flex-wrap items-center gap-2 rounded-xl border-2 border-dashed p-2",
          outcome?.result === "correct" && "border-correct bg-correct-soft",
          outcome && outcome.result !== "correct" && "border-wrong bg-wrong-soft",
        )}
      >
        {sequence.map((id, i) => (
          <button
            type="button"
            key={id}
            disabled={!!outcome}
            className={cn(chip, "border-primary")}
            onClick={() => onAnswer({ sequence: sequence.filter((_, j) => j !== i) })}
          >
            <OptionContent option={byId(id)} url={url} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {pool.map((p) => {
          const used = sequence.includes(p.id);
          return (
            <button
              type="button"
              key={p.id}
              disabled={used || !!outcome}
              className={cn(
                chip,
                used && "opacity-30",
                !used && !outcome && "hover:border-primary/60",
              )}
              onClick={() => onAnswer({ sequence: [...sequence, p.id] })}
            >
              <OptionContent option={p} url={url} />
            </button>
          );
        })}
      </div>
      {!outcome && sequence.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => onAnswer({ sequence: [] })}>
          {t("ex.reset")}
        </Button>
      )}
    </div>
  );
}
