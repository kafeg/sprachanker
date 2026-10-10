// Courses (09): one page in three tabs — My courses (started, ready to continue), Downloaded (installed,
// started or not) and Available (every course a provider offers that is not here yet) — each narrowed by
// the pair and course filters. A course teaches one language to speakers of one language (its edition);
// another pair of the same source course is a course of its own.
import { useTranslation } from "react-i18next";
import { useCatalog, useCourses, useSettings } from "@/api/hooks.ts";
import { offersOf, useShown } from "@/app/experimental.ts";
import { CourseCard, MyCourseCard } from "@/courses/card.tsx";
import { CATALOG_FILTERS, MY_FILTERS, useCourseFilters } from "@/courses/filters.tsx";
import { OfferCard } from "@/library/card.tsx";
import { CardGrid, type LibraryTab, LibraryTabPage, NoneHere } from "@/library/tab-page.tsx";
import { EmptyState, ErrorState, Loading } from "@/ui/page.tsx";

export type CoursesTab = LibraryTab;
const PATH: Record<CoursesTab, "/" | "/downloaded" | "/catalog"> = {
  mine: "/",
  downloaded: "/downloaded",
  available: "/catalog",
};

function useCourseList() {
  const courses = useCourses();
  const settings = useSettings();
  const { shown, ready } = useShown();
  if (courses.isPending || settings.isPending || !ready) return { state: <Loading /> };
  if (courses.isError)
    return { state: <ErrorState error={courses.error} onRetry={() => courses.refetch()} /> };
  return {
    all: courses.data.filter((c) => shown("courses", c.series)),
    settings: settings.data ?? {},
  };
}

export function CoursesPage({ tab }: { tab: CoursesTab }) {
  const { t } = useTranslation();
  const { shown, ready } = useShown();
  const all = (useCourses().data ?? []).filter((c) => shown("courses", c.series));
  const offers = offersOf(useCatalog().data, "courses", shown);
  const count: Record<CoursesTab, number> = {
    mine: all.filter((c) => c.started).length,
    downloaded: all.reduce((n, c) => n + c.editions.length, 0),
    available: offers.length,
  };
  return (
    <LibraryTabPage
      title={t("nav.courses")}
      tab={tab}
      paths={PATH}
      label={(id) => t(`courses.tabs.${id}`)}
      counts={ready ? count : undefined}
    >
      {tab === "mine" ? <MyCourses /> : tab === "downloaded" ? <Downloaded /> : <Available />}
    </LibraryTabPage>
  );
}

function MyCourses() {
  const { t } = useTranslation();
  const list = useCourseList();
  const mine = (list.all ?? []).filter((c) => c.started);
  const filters = useCourseFilters(
    mine.map((c) => ({
      c,
      titles: c.editions.map((e) => c.titles[e] || c.key),
      editions: c.editions,
    })),
    MY_FILTERS,
    list.settings ?? {},
  );
  if (!list.all) return list.state;
  if (!mine.length)
    return (
      <NoneHere
        text={t("courses.noneStarted")}
        link={{ to: "/catalog", label: t("courses.toCatalog") }}
      />
    );
  return (
    <>
      {(mine.length > 1 || filters.active) && filters.bar}
      {filters.shown.length ? (
        <CardGrid>
          {filters.shown.map(({ c }) => (
            <MyCourseCard key={c.key} course={c} />
          ))}
        </CardGrid>
      ) : (
        <EmptyState>{t("courses.noneMatch")}</EmptyState>
      )}
    </>
  );
}

function Downloaded() {
  const { t } = useTranslation();
  const list = useCourseList();
  // Each edition of an installed course is a card of its own.
  const cards = (list.all ?? []).flatMap((course) =>
    course.editions.map((edition) => ({
      key: `${course.key}:${edition}`,
      course,
      edition,
      titles: [course.titles[edition] || course.key],
      editions: [edition],
    })),
  );
  const filters = useCourseFilters(cards, CATALOG_FILTERS, list.settings ?? {});
  if (!list.all) return list.state;
  if (!cards.length)
    return (
      <NoneHere
        text={t("courses.noneDownloaded")}
        link={{ to: "/catalog", label: t("courses.toCatalog") }}
      />
    );
  return (
    <>
      {filters.bar}
      {filters.shown.length ? (
        <CardGrid>
          {filters.shown.map((c) => (
            <CourseCard key={c.key} course={c.course} edition={c.edition} upkeep />
          ))}
        </CardGrid>
      ) : (
        <EmptyState>{t("courses.noneMatch")}</EmptyState>
      )}
    </>
  );
}

function Available() {
  const { t } = useTranslation();
  const list = useCourseList();
  const catalog = useCatalog();
  const { shown } = useShown();
  const cards = offersOf(catalog.data, "courses", shown).map((offer) => ({
    key: offer.key,
    offer,
    titles: [offer.title],
    editions: [offer.edition],
  }));
  const filters = useCourseFilters(cards, CATALOG_FILTERS, list.settings ?? {});
  if (!list.all) return list.state;
  if (!cards.length) return <NoneHere text={t("courses.allDownloaded")} />;
  return (
    <>
      {filters.bar}
      {filters.shown.length ? (
        <CardGrid>
          {filters.shown.map((c) => (
            <OfferCard key={c.key} offer={c.offer} />
          ))}
        </CardGrid>
      ) : (
        <EmptyState>{t("courses.noneMatch")}</EmptyState>
      )}
    </>
  );
}
