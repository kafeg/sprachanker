// What a course's and an exam's cards share (09): the card itself — a band with the language pair, a
// figure and, on "My …", the way to remove it (its progress reset), an optional bar under it, then its
// download when one runs or files are missing, and the card's own body —; an offer not downloaded
// yet, with its size and "Download"; the publisher linked to its site.
import type { CourseSource, ExamKey } from "@sprachanker/schema";
import { CircleAlert, Download, ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCatalog, useCourseDownload, useStartDownload } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { PairFlags } from "@/ui/flags.tsx";
import { useBytes } from "@/ui/format.ts";
import { panelClass } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";
import { DownloadLine, downloading } from "./download.tsx";
import { ResetProgress } from "./reset-progress.tsx";

type CatalogEntry = NonNullable<ReturnType<typeof useCatalog>["data"]>[number];

/** A course's or an exam's card: its band, then its download state and its body. */
export function LibraryCard({
  series,
  course,
  edition,
  figure,
  share,
  remove,
  children,
}: {
  series: string;
  course: string;
  edition: string;
  /** What the band says beside the flags (lessons done, the last mock exam's points). */
  figure: React.ReactNode;
  /** A bar under the band: how much is done, 0..1. */
  share?: number;
  /** On "My …": it can be removed from there, its progress reset (an exam's alone: `exam`). */
  remove?: { title: string; label: string; exam?: ExamKey };
  children: React.ReactNode;
}) {
  return (
    <div className={cn(panelClass, "flex flex-col overflow-hidden shadow-sm")}>
      <div className="flex min-h-14 items-center gap-3 bg-primary/15 px-4">
        <PairFlags edition={edition} size="md" />
        <span className="ml-auto text-sm tabular-nums text-muted-foreground">{figure}</span>
        {remove && (
          <ResetProgress series={series} course={course} exam={remove.exam} title={remove.title}>
            {(open) => (
              <Button
                variant="ghost"
                size="icon"
                onClick={open}
                aria-label={remove.label}
                title={remove.label}
                className="-mr-2 text-muted-foreground"
              >
                <X className="size-4" />
              </Button>
            )}
          </ResetProgress>
        )}
      </div>
      {share !== undefined && <Progress value={share * 100} className="h-1 rounded-none" />}
      <div className="flex flex-1 flex-col p-4">
        <DownloadState series={series} course={course} />
        {children}
      </div>
    </div>
  );
}

/** A course's download on its card: progress while it runs; files missing with "Continue" after. */
export function DownloadState({ series, course }: { series: string; course: string }) {
  const { t } = useTranslation();
  const { job } = useCourseDownload(series, course);
  const entry = useCatalog().data?.find((e) => e.series === series && e.course === course);
  const start = useStartDownload();
  if (job && downloading(job)) return <DownloadLine job={job} className="mb-3" />;
  if (entry?.state !== "incomplete") return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg bg-wrong-soft px-3 py-1.5 text-sm">
      <CircleAlert className="size-4 shrink-0 text-wrong" />
      <span className="flex-1">{t("download.incomplete", { count: entry.missing ?? 0 })}</span>
      <Button
        size="sm"
        variant="outline"
        loading={start.isPending}
        onClick={() => start.mutate({ series, course })}
      >
        {t("download.continue")}
      </Button>
    </div>
  );
}

/** A course or an exam offered but not downloaded yet: the card with its size and "Download". */
export function OfferCard({ offer }: { offer: CatalogEntry }) {
  const { t } = useTranslation();
  const bytes = useBytes();
  const { job } = useCourseDownload(offer.series, offer.course);
  const start = useStartDownload();
  const busy = downloading(job);
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-dashed bg-card">
      <div className="flex min-h-14 items-center gap-3 bg-muted px-4">
        <PairFlags edition={offer.edition} size="md" />
        <span className="ml-auto text-sm text-muted-foreground">{t("download.notDownloaded")}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="line-clamp-2 text-xl font-bold leading-tight" title={offer.title}>
          {offer.title}
        </h2>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          <PublisherLink source={offer.source} />
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {t(`course.licence.${offer.source.licence}`)}
        </p>
        <div className="mt-auto pt-4">
          {busy && job ? (
            <>
              <DownloadLine job={job} />
              <p className="mt-2 text-xs text-muted-foreground">{t("download.openSoon")}</p>
            </>
          ) : (
            <Button
              size="lg"
              className="w-full"
              disabled={start.isPending}
              onClick={() => start.mutate({ series: offer.series, course: offer.course })}
            >
              <Download className="size-4" />
              {t("download.downloadSize", { size: bytes(offer.approxBytes) })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The publisher, linked to its site (cut to fit a card; hover shows it whole). */
export function PublisherLink({ source }: { source: CourseSource }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={source.publisher}
      className="flex min-w-0 items-center gap-0.5 underline-offset-4 hover:underline"
    >
      <span className="truncate">{source.publisher}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}
