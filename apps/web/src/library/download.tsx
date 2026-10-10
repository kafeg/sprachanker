// A course download (06, 09): its progress as a line with a bar — queued, pages read, lessons being
// prepared, media with files and bytes — shared by the course cards and the course page.
import { useTranslation } from "react-i18next";
import type { useDownloads } from "@/api/downloads.ts";
import { Progress } from "@/ui/components/progress.tsx";
import { useBytes } from "@/ui/format.ts";
import { cn } from "@/ui/utils.ts";

export type DownloadJob = NonNullable<ReturnType<typeof useDownloads>["data"]>["jobs"][number];

export const downloading = (job: DownloadJob | undefined) =>
  job?.status === "queued" || job?.status === "running";

export function DownloadLine({ job, className }: { job: DownloadJob; className?: string }) {
  const { t } = useTranslation();
  const bytes = useBytes();
  const p = job.progress;
  const media = p?.phase === "media" ? p.media : undefined;
  const text =
    job.status === "queued"
      ? t("download.queued")
      : media
        ? t("download.media", { done: media.done, total: media.total, size: bytes(media.bytes) })
        : p?.phase === "normalise"
          ? t("download.preparing")
          : t("download.pages", { count: p?.pages ?? 0 });
  return (
    <div className={cn("space-y-1", className)} role="status">
      <Progress
        value={media?.total ? (media.done / media.total) * 100 : 0}
        className={cn("h-1.5", !media && "animate-pulse")}
      />
      <p className="text-xs text-muted-foreground tabular-nums">{text}</p>
    </div>
  );
}
