// Exams (09; owner's choices from the mockups, 2026-10-10): one page in three tabs as Courses — My
// exams (begun), Downloaded (installed: exam courses and the exams of courses) and Available (exams a
// provider offers that are not here yet).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEdition } from "@/api/edition.ts";
import { type ExamRow, useExams } from "@/api/exams.ts";
import { useCatalog } from "@/api/hooks.ts";
import { useShown } from "@/app/experimental.ts";
import { OfferCard } from "@/courses/card.tsx";
import { ExamCard } from "@/exams/card.tsx";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { SectionTabs } from "@/ui/section-tabs.tsx";

export type ExamsTab = "mine" | "downloaded" | "available";
const PATH: Record<ExamsTab, "/exams" | "/exams/downloaded" | "/exams/catalog"> = {
  mine: "/exams",
  downloaded: "/exams/downloaded",
  available: "/exams/catalog",
};

export function ExamsPage({ tab }: { tab: ExamsTab }) {
  const { t } = useTranslation();
  const exams = useExams();
  const shown = useShown();
  const all = (exams.data ?? []).filter((e) => shown("exams", e.series));
  const offers = (useCatalog().data ?? []).filter(
    (o) => !o.installed && o.kind === "exam" && shown("exams", o.series),
  );
  const count: Record<ExamsTab, number> = {
    mine: all.filter((e) => e.started).length,
    downloaded: all.length,
    available: offers.length,
  };
  const list = (rows: ExamRow[], empty: React.ReactNode) =>
    exams.isPending ? (
      <Loading />
    ) : exams.isError ? (
      <ErrorState error={exams.error} onRetry={() => exams.refetch()} />
    ) : rows.length ? (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((e) => (
          <EditionCard key={e.key} exam={e} tab={tab} />
        ))}
      </div>
    ) : (
      empty
    );
  return (
    <Page title={t("nav.exams")}>
      <SectionTabs
        label={t("nav.exams")}
        tabs={(["mine", "downloaded", "available"] as const).map((id) => ({
          to: PATH[id],
          label: t(`exams.tabs.${id}`),
          count: count[id],
          current: tab === id,
        }))}
      />
      {tab === "mine" &&
        list(
          all.filter((e) => e.started),
          <EmptyState className="text-foreground">
            <p className="text-lg">{t("exams.noneStarted")}</p>
            <Link
              to={all.length ? "/exams/downloaded" : "/exams/catalog"}
              className="mt-3 inline-block font-medium underline"
            >
              {t(all.length ? "exams.toDownloaded" : "exams.toCatalog")}
            </Link>
          </EmptyState>,
        )}
      {tab === "downloaded" &&
        list(
          all,
          <EmptyState className="text-foreground">
            <p className="text-lg">{t("exams.noneDownloaded")}</p>
            <Link to="/exams/catalog" className="mt-3 inline-block font-medium underline">
              {t("exams.toCatalog")}
            </Link>
          </EmptyState>,
        )}
      {tab === "available" &&
        (offers.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {offers.map((o) => (
              <OfferCard key={o.key} offer={o} />
            ))}
          </div>
        ) : (
          <EmptyState className="text-lg text-foreground">{t("exams.allDownloaded")}</EmptyState>
        ))}
    </Page>
  );
}

/** An exam's card in the edition it is shown in. */
function EditionCard({ exam, tab }: { exam: ExamRow; tab: string }) {
  const edition = useEdition(exam.series, exam.course, exam.editions);
  return edition ? (
    <ExamCard
      exam={exam}
      edition={edition}
      removable={tab === "mine"}
      upkeep={tab === "downloaded"}
    />
  ) : null;
}
