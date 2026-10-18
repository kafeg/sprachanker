// Settings → Storage: where the data lives — chosen when the server starts (`--data`,
// SPRACHANKER_DATA, else the app-data folder) — the space each source takes (courses of one source
// share their media, so space is shown per source) and the profile's recordings, all deleted after
// asking.
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalog, useStorage } from "@/api/courses.ts";
import { useDeleteRecordings, useRecordingStats } from "@/api/recordings.ts";
import { Button } from "@/ui/components/button.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { useBytes, useNumber } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";

/** The profile's recordings: how many, their size, all deleted after asking. */
function Recordings() {
  const { t } = useTranslation();
  const stats = useRecordingStats();
  const remove = useDeleteRecordings();
  const bytes = useBytes();
  const count = useNumber();
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm">
      <span className="font-medium">{t("storage.recordings")}</span>
      <span className="text-muted-foreground">
        {stats.data
          ? t("storage.recordingsKept", {
              count: stats.data.count,
              n: count(stats.data.count),
              size: bytes(stats.data.bytes),
            })
          : "…"}
      </span>
      {!!stats.data?.count && (
        <Button variant="outline" size="sm" className="ms-auto" onClick={() => setAsking(true)}>
          <Trash2 className="size-4" /> {t("storage.deleteRecordings")}
        </Button>
      )}
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t("storage.deleteRecordingsTitle")}
        description={t("storage.deleteRecordingsBody")}
        confirm={t("storage.deleteRecordings")}
        cancel={t("common.cancel")}
        busy={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setAsking(false) })}
      />
    </div>
  );
}

export function StorageSection() {
  const { t } = useTranslation();
  const storage = useStorage().data;
  const catalog = useCatalog().data;
  const bytes = useBytes();
  if (!storage)
    return (
      <Panel title={t("storage.title")} className="space-y-2">
        <Recordings />
      </Panel>
    );
  const total = storage.series.reduce((sum, s) => sum + s.bytes, 0);
  // A source's name: the titles of its courses in the catalogue. Sources it does not offer (the
  // experimental ones, on a server started without --experimental) are one row, not shown by name.
  const titlesOf = (series: string) => [
    ...new Set((catalog ?? []).filter((o) => o.series === series).map((o) => o.title)),
  ];
  const offered = storage.series.filter((s) => !catalog || titlesOf(s.series).length);
  const notShown = storage.series
    .filter((s) => !offered.includes(s))
    .reduce((sum, s) => sum + s.bytes, 0);
  const sources = [
    ...offered
      .map((s) => ({ ...s, name: titlesOf(s.series).join(", ") || s.series }))
      .toSorted((a, b) => b.bytes - a.bytes),
    ...(notShown ? [{ series: "", bytes: notShown, name: t("storage.notShown") }] : []),
  ];
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
            {sources.map((s, i) => (
              <span
                key={s.series}
                title={t("storage.seriesSize", { name: s.name, size: bytes(s.bytes) })}
                style={{ width: `${(s.bytes / (total + (storage.free ?? 0))) * 100}%` }}
                className={
                  ["bg-primary", "bg-primary/70", "bg-primary/45", "bg-primary/30"][Math.min(i, 3)]
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
      {sources.length > 0 && (
        <ul className="divide-y rounded-xl border text-sm">
          {sources.map((s) => (
            <li key={s.series} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1">{s.name}</span>
              <span className="tabular-nums text-muted-foreground">{bytes(s.bytes)}</span>
            </li>
          ))}
          <li className="flex items-center gap-3 px-3 py-2 font-medium">
            <span className="flex-1">{t("storage.total")}</span>
            <span className="tabular-nums">{bytes(total)}</span>
          </li>
        </ul>
      )}
      <Recordings />
    </Panel>
  );
}
