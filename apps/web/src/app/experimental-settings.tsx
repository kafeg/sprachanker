// Settings → Experimental (owner, 2026-10-10): what is not ready for learning yet, off until the
// learner turns it on — first a whole section (courses, exams), then each of its sources. Said plainly
// at the top: an experiment, not a way to prepare.
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type CatalogRow, useCatalog, useSetSetting, useSetting } from "@/api/hooks.ts";
import { cn } from "@/ui/utils.ts";
import { type ExperimentalSection, sectionOn, sourceId } from "./experimental.ts";

const SECTIONS: ExperimentalSection[] = ["courses", "exams"];

/** A section's experimental sources: each series with its publisher and the titles it offers. */
function sourcesOf(catalog: CatalogRow[], section: ExperimentalSection) {
  const own = catalog.filter(
    (o) => o.experimental && (o.kind === "exam") === (section === "exams"),
  );
  return [...new Set(own.map((o) => o.series))].map((series) => {
    const offers = own.filter((o) => o.series === series);
    return {
      series,
      publisher: offers[0]?.source.publisher ?? series,
      titles: [...new Set(offers.map((o) => o.title))],
    };
  });
}

export function ExperimentalSettings() {
  const { t } = useTranslation();
  const set = useSetSetting();
  const on = useSetting("experimental.on");
  const catalog = useCatalog().data ?? [];
  const toggle = (id: string, value: boolean) =>
    set.mutate({
      key: "experimental.on",
      value: value ? [...new Set([...on, id])] : on.filter((x) => x !== id),
    });
  return (
    <div className="space-y-6">
      <div className="flex gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">{t("experimental.disclaimerTitle")}</p>
          <p className="text-sm">{t("experimental.disclaimer")}</p>
        </div>
      </div>
      {SECTIONS.map((section) => {
        const sources = sourcesOf(catalog, section);
        const open = sectionOn(on, section);
        return (
          <section key={section} className="rounded-2xl border bg-card px-4 py-3">
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={open}
                onChange={(e) => toggle(section, e.target.checked)}
              />
              <span>
                <span className="font-semibold">{t(`experimental.section.${section}`)}</span>
                <span className="block text-sm text-muted-foreground">
                  {t(`experimental.sectionHint.${section}`)}
                </span>
              </span>
            </label>
            {sources.length > 0 ? (
              <div className={cn("mt-1 divide-y border-t pl-8", !open && "opacity-50")}>
                {sources.map((s) => (
                  <label key={s.series} className="flex min-h-11 items-start gap-3 py-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-5 accent-primary"
                      disabled={!open}
                      checked={on.includes(sourceId(section, s.series))}
                      onChange={(e) => toggle(sourceId(section, s.series), e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{s.publisher}</span>
                      <span className="block text-sm text-muted-foreground">
                        {s.titles.slice(0, 4).join(" · ")}
                        {s.titles.length > 4 &&
                          ` · ${t("experimental.more", { count: s.titles.length - 4 })}`}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-1 border-t pt-2 pl-8 text-sm text-muted-foreground">
                {t("experimental.none")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
