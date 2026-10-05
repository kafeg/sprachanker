import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/ui/utils.ts";
import { OptionContent, useShuffled } from "./shared.tsx";
import type { RendererProps } from "./types.ts";

export function Match({ item, answer, onAnswer, outcome, url }: RendererProps<"match">) {
  const { t } = useTranslation();
  const right = useShuffled(item.right, item.key);
  const pictures = right.some((r) => r.media?.image);
  const label = (id: string) => {
    const r = right.find((x) => x.id === id);
    return r?.text ?? t("ex.picture", { n: right.indexOf(r as never) + 1 });
  };
  const chosen = new Map<string, string>(answer?.pairs ?? []);
  const want = new Map<string, string>(item.answer.pairs);
  const set = (left: string, value: string) => {
    const next = new Map(chosen);
    value ? next.set(left, value) : next.delete(left);
    onAnswer({ pairs: [...next] });
  };
  const sameText = (a?: string, b?: string) => {
    const x = item.right.find((r) => r.id === a)?.text;
    return a === b || (!!x && x === item.right.find((r) => r.id === b)?.text);
  };
  return (
    <div className="space-y-3">
      {pictures && (
        <div className="flex flex-wrap gap-3">
          {right.map((r, i) => (
            <figure key={r.id} className="rounded-xl border bg-card p-2">
              <OptionContent option={r} url={url} />
              <figcaption className="mt-1 text-center text-sm text-muted-foreground">
                {t("ex.picture", { n: i + 1 })}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {item.left.map((l) => {
        const ok = outcome ? sameText(chosen.get(l.id), want.get(l.id)) : undefined;
        return (
          <div key={l.id} className="flex flex-wrap items-center gap-3">
            <span className="min-w-40 text-lg font-semibold">
              <OptionContent option={l} url={url} />
            </span>
            <span aria-hidden>→</span>
            <select
              value={chosen.get(l.id) ?? ""}
              disabled={!!outcome}
              onChange={(e) => set(l.id, e.target.value)}
              className={cn(
                "h-11 min-w-40 rounded-lg border-2 bg-card px-3 text-lg",
                ok === true && "border-correct",
                ok === false && "border-wrong",
              )}
            >
              <option value="">—</option>
              {right.map((r) => (
                <option key={r.id} value={r.id}>
                  {label(r.id)}
                </option>
              ))}
            </select>
            {ok === true && <Check className="size-5 text-correct" aria-hidden />}
            {ok === false && (
              <span className="flex items-center gap-1 text-wrong">
                <X className="size-5" aria-hidden /> {label(want.get(l.id) ?? "")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
