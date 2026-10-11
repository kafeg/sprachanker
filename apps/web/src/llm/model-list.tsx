// Settings → AI assistant: a provider's models as a list with search and the filters its metadata allows
// (07; 09) — free, answers in JSON, context, publisher — instead of a drop-down of hundreds.
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Chip } from "@/ui/chip.tsx";
import { Input } from "@/ui/components/input.tsx";
import { useCompact, useDollars } from "@/ui/format.ts";
import { cn } from "@/ui/utils.ts";
import {
  CONTEXT_STEPS,
  filterModels,
  groupModels,
  initialFilters,
  type ModelFilters,
  modelFacets,
} from "./model-filter.ts";
import type { ListedModel } from "./setup-api.ts";

/** Publishers shown as filters before "more". */
const TOP_PUBLISHERS = 6;

export function ModelList({
  models,
  value,
  onPick,
}: {
  models: ListedModel[];
  /** The model in use. */
  value: string | null;
  onPick(id: string): void;
}) {
  const { t } = useTranslation();
  const dollars = useDollars();
  const compact = useCompact();
  const [filters, setFilters] = useState<ModelFilters>(() => initialFilters(models));
  const [allPublishers, setAllPublishers] = useState(false);
  const facets = modelFacets(models);
  const shown = filterModels(models, filters, value ?? undefined);
  const groups = groupModels(shown);
  const set = (change: Partial<ModelFilters>) => setFilters((f) => ({ ...f, ...change }));
  const publishers = allPublishers ? facets.publishers : facets.publishers.slice(0, TOP_PUBLISHERS);
  const togglePublisher = (p: string) =>
    set({
      publishers: filters.publishers.includes(p)
        ? filters.publishers.filter((x) => x !== p)
        : [...filters.publishers, p],
    });

  return (
    <div className="space-y-2">
      <Input
        className="h-11"
        type="search"
        spellCheck={false}
        placeholder={t("llm.list.search")}
        aria-label={t("llm.list.search")}
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
      />
      <div className="flex flex-wrap gap-1.5">
        {facets.free > 0 && (
          <Chip on={filters.free} onClick={() => set({ free: !filters.free })}>
            {t("llm.list.free", { count: facets.free })}
          </Chip>
        )}
        {facets.json > 0 && (
          <Chip on={filters.json} onClick={() => set({ json: !filters.json })}>
            {t("llm.list.json", { count: facets.json })}
          </Chip>
        )}
        {facets.context &&
          CONTEXT_STEPS.map((n) => (
            <Chip
              key={n}
              on={filters.minContext === n}
              onClick={() => set({ minContext: filters.minContext === n ? undefined : n })}
            >
              {t("llm.list.context", { size: compact(n) })}
            </Chip>
          ))}
        {publishers.map(([p]) => (
          <Chip key={p} on={filters.publishers.includes(p)} onClick={() => togglePublisher(p)}>
            {p}
          </Chip>
        ))}
        {facets.publishers.length > TOP_PUBLISHERS && (
          <Chip on={false} onClick={() => setAllPublishers((all) => !all)}>
            {allPublishers ? t("llm.list.fewer") : t("llm.list.more")}
          </Chip>
        )}
      </div>
      {facets.json > 0 && <p className="text-sm text-muted-foreground">{t("llm.list.jsonHint")}</p>}
      <div className="max-h-96 overflow-y-auto rounded-xl border bg-card">
        {shown.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("llm.list.none")}</p>
        ) : (
          groups.map((g) => (
            <div key={g.publisher}>
              {groups.length > 1 && (
                <p className="sticky top-0 bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {g.publisher}
                </p>
              )}
              {g.models.map((m) => {
                const chosen = m.id === value;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => onPick(m.id)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b px-3 py-2 text-start last:border-b-0 hover:bg-accent pointer-coarse:min-h-11",
                      chosen && "bg-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {m.name ?? m.id}
                        {m.free && (
                          <span className="ms-2 rounded bg-correct-soft px-1.5 text-xs text-correct">
                            {t("llm.list.freeTag")}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[m.id, m.contextLength && compact(m.contextLength)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {m.price && !m.free && (
                      <span className="shrink-0 text-end text-xs text-muted-foreground tabular-nums">
                        {t("llm.list.price", {
                          input: dollars(m.price.input),
                          output: dollars(m.price.output),
                        })}
                      </span>
                    )}
                    {chosen && <Check className="size-4 shrink-0 text-correct" aria-hidden />}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("llm.list.shown", { shown: shown.length, total: models.length })}
      </p>
    </div>
  );
}
