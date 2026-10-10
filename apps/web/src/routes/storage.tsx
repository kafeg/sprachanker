// Settings → Storage (05, 09): where the data lives — chosen when the server starts (`--data`,
// SPRACHANKER_DATA, else the app-data folder) — and the space each source takes. Courses of one source
// share their media, so space is shown per source.
import { useTranslation } from "react-i18next";
import { useCatalog, useStorage } from "@/api/courses.ts";
import { useBytes } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";

export function StorageSection() {
  const { t } = useTranslation();
  const storage = useStorage().data;
  const catalog = useCatalog().data ?? [];
  const bytes = useBytes();
  if (!storage) return null;
  const total = storage.series.reduce((sum, s) => sum + s.bytes, 0);
  // A source's name: the publisher and titles of its courses in the catalogue.
  const nameOf = (series: string) => {
    const offers = catalog.filter((o) => o.series === series);
    return offers.length ? [...new Set(offers.map((o) => o.title))].join(", ") : series;
  };
  return (
    <Panel title={t("storage.title")} className="space-y-2">
      {/* The font joins "--" into a dash: the flag stays two hyphens, as typed. */}
      <p className="text-sm text-muted-foreground [font-variant-ligatures:none]">
        {t("storage.intro")}
      </p>
      <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">
        {storage.dataRoot}
      </p>
      {total > 0 && (
        <div className="space-y-1.5">
          {/* The space of each source on the disk's used-and-free scale. */}
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {storage.series
              .toSorted((a, b) => b.bytes - a.bytes)
              .map((s, i) => (
                <span
                  key={s.series}
                  title={t("storage.seriesSize", { name: nameOf(s.series), size: bytes(s.bytes) })}
                  style={{ width: `${(s.bytes / (total + (storage.free ?? 0))) * 100}%` }}
                  className={
                    ["bg-primary", "bg-primary/70", "bg-primary/45", "bg-primary/30"][
                      Math.min(i, 3)
                    ]
                  }
                />
              ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {storage.free === null
              ? t("storage.used", { size: bytes(total) })
              : t("storage.usedFree", { size: bytes(total), free: bytes(storage.free) })}
          </p>
        </div>
      )}
      {storage.series.length > 0 && (
        <ul className="divide-y rounded-xl border text-sm">
          {storage.series
            .toSorted((a, b) => b.bytes - a.bytes)
            .map((s) => (
              <li key={s.series} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1">{nameOf(s.series)}</span>
                <span className="tabular-nums text-muted-foreground">{bytes(s.bytes)}</span>
              </li>
            ))}
          <li className="flex items-center gap-3 px-3 py-2 font-medium">
            <span className="flex-1">{t("storage.total")}</span>
            <span className="tabular-nums">{bytes(total)}</span>
          </li>
        </ul>
      )}
    </Panel>
  );
}
