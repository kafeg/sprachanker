// Settings → Storage (05, 09): where the data lives — chosen when the server starts (`--data`,
// SPRACHANKER_DATA, else the app-data folder) — and the space each source takes. Courses of one source
// share their media, so space is shown per source.
import { useTranslation } from "react-i18next";
import { useCatalog, useStorage } from "@/api/hooks.ts";
import { useBytes } from "./download.tsx";

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
    <section className="space-y-2">
      <h2 className="text-xl font-bold">{t("storage.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("storage.intro")}</p>
      <p className="break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">
        {storage.dataRoot}
      </p>
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
    </section>
  );
}
