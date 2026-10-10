// Settings → General → Experimental (owner, 2026-10-10): what is not ready for learning yet, off until
// the learner turns it on — first a whole section (courses, exams), then each of its sources. Said
// plainly at the top: an experiment, not a way to prepare.
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type CatalogRow, useCatalog, useSetSetting, useSetting } from "@/api/hooks.ts";
import { CheckRow } from "@/ui/check-row.tsx";
import { Loading } from "@/ui/page.tsx";
import { panelClass } from "@/ui/panel.tsx";
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
  const query = useCatalog();
  const catalog = query.data ?? [];
  const toggle = (id: string, value: boolean) =>
    set.mutate({
      key: "experimental.on",
      value: value ? [...new Set([...on, id])] : on.filter((x) => x !== id),
    });
  return (
    <section id="experimental" className="space-y-3">
      <h2 className="text-xl font-bold">{t("settings.experimental")}</h2>
      {query.isPending ? (
        <Loading />
      ) : (
        <>
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
              <div key={section} className={cn(panelClass, "px-4 py-1")}>
                <CheckRow
                  checked={open}
                  onChange={(value) => toggle(section, value)}
                  title={t(`experimental.section.${section}`)}
                  hint={t(`experimental.sectionHint.${section}`)}
                />
                {sources.length > 0 ? (
                  <div className="divide-y border-t pl-8">
                    {sources.map((s) => (
                      <CheckRow
                        key={s.series}
                        disabled={!open}
                        checked={on.includes(sourceId(section, s.series))}
                        onChange={(value) => toggle(sourceId(section, s.series), value)}
                        title={s.publisher}
                        hint={
                          s.titles.slice(0, 4).join(" · ") +
                          (s.titles.length > 4
                            ? ` · ${t("experimental.more", { count: s.titles.length - 4 })}`
                            : "")
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="border-t py-2 pl-8 text-sm text-muted-foreground">
                    {t("experimental.none")}
                  </p>
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
