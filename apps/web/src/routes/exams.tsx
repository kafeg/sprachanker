// Exams (09; owner's choices from the mockups, 2026-10-10): one page in three tabs as Courses (the
// library's tab page) — My exams (begun), Downloaded (installed: exam courses and the exams of courses)
// and Available (exams a provider offers that are not here yet).
import { useTranslation } from "react-i18next";
import { useCatalog } from "@/api/courses.ts";
import { useEdition } from "@/api/edition.ts";
import { type ExamRow, useExams } from "@/api/exams.ts";
import { offersOf, useShown } from "@/app/experimental.ts";
import { ExamCard } from "@/exams/card.tsx";
import { OfferCard } from "@/library/card.tsx";
import { CardGrid, type LibraryTab, LibraryTabPage, NoneHere } from "@/library/tab-page.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";

type ExamsTab = LibraryTab;
const PATH: Record<ExamsTab, "/exams" | "/exams/downloaded" | "/exams/catalog"> = {
  mine: "/exams",
  downloaded: "/exams/downloaded",
  available: "/exams/catalog",
};

export function ExamsPage({ tab }: { tab: ExamsTab }) {
  const { t } = useTranslation();
  const exams = useExams();
  const { shown, ready } = useShown();
  const all = (exams.data ?? []).filter((e) => shown("exams", e.series));
  const catalog = useCatalog();
  const offers = offersOf(catalog.data, "exams", shown);
  const count: Record<ExamsTab, number> = {
    mine: all.filter((e) => e.started).length,
    downloaded: all.length,
    available: offers.length,
  };
  const list = (rows: ExamRow[], empty: React.ReactNode) =>
    exams.isPending || !ready ? (
      <Loading />
    ) : exams.isError ? (
      <ErrorState error={exams.error} onRetry={() => exams.refetch()} />
    ) : rows.length ? (
      <CardGrid>
        {rows.map((e) => (
          <EditionCard key={e.key} exam={e} tab={tab} />
        ))}
      </CardGrid>
    ) : (
      empty
    );
  return (
    <LibraryTabPage
      title={t("nav.exams")}
      tab={tab}
      paths={PATH}
      label={(id) => t(`exams.tabs.${id}`)}
      counts={ready ? count : undefined}
    >
      {tab === "mine" &&
        list(
          all.filter((e) => e.started),
          <NoneHere
            text={t("exams.noneStarted")}
            link={
              all.length
                ? { to: "/exams/downloaded", label: t("exams.toDownloaded") }
                : { to: "/exams/catalog", label: t("exams.toCatalog") }
            }
          />,
        )}
      {tab === "downloaded" &&
        list(
          all,
          <NoneHere
            text={t("exams.noneDownloaded")}
            link={{ to: "/exams/catalog", label: t("exams.toCatalog") }}
          />,
        )}
      {tab === "available" &&
        (!ready ? (
          <Loading />
        ) : catalog.isError ? (
          <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />
        ) : offers.length ? (
          <CardGrid>
            {offers.map((o) => (
              <OfferCard key={o.key} offer={o} />
            ))}
          </CardGrid>
        ) : (
          <NoneHere text={t("exams.allDownloaded")} />
        ))}
    </LibraryTabPage>
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
