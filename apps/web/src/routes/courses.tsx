// Courses (09): one page in three tabs — My courses (started, ready to continue), Downloaded (installed,
// started or not) and Available (every course a provider offers that is not here yet) — each narrowed by
// the pair and course filters. A course teaches one language to speakers of one language (its edition);
// another pair of the same source course is a course of its own.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCatalog, useCourses, useSettings } from "@/api/hooks.ts";
import { CourseCard, MyCourseCard, OfferCard } from "@/courses/card.tsx";
import { CATALOG_FILTERS, MY_FILTERS, useCourseFilters } from "@/courses/filters.tsx";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { SectionTabs } from "@/ui/section-tabs.tsx";

export type CoursesTab = "mine" | "downloaded" | "available";
const PATH: Record<CoursesTab, "/" | "/downloaded" | "/catalog"> = {
  mine: "/",
  downloaded: "/downloaded",
  available: "/catalog",
};

function useCourseList() {
  const courses = useCourses();
  const settings = useSettings();
  if (courses.isPending || settings.isPending) return { state: <Loading /> };
  if (courses.isError)
    return { state: <ErrorState error={courses.error} onRetry={() => courses.refetch()} /> };
  return { all: courses.data, settings: settings.data ?? {} };
}

export function CoursesPage({ tab }: { tab: CoursesTab }) {
  const { t } = useTranslation();
  const all = useCourses().data ?? [];
  const offers = (useCatalog().data ?? []).filter((o) => !o.installed);
  const count: Record<CoursesTab, number> = {
    mine: all.filter((c) => c.started).length,
    downloaded: all.reduce((n, c) => n + c.editions.length, 0),
    available: offers.length,
  };
  return (
    <Page title={t("nav.courses")}>
      <SectionTabs
        label={t("nav.courses")}
        tabs={(["mine", "downloaded", "available"] as const).map((id) => ({
          to: PATH[id],
          label: t(`courses.tabs.${id}`),
          count: count[id],
          current: tab === id,
        }))}
      />
      {tab === "mine" ? <MyCourses /> : tab === "downloaded" ? <Downloaded /> : <Available />}
    </Page>
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
      <EmptyState className="text-foreground">
        <p className="text-lg">{t("courses.noneStarted")}</p>
        <Link to="/catalog" className="mt-3 inline-block font-medium underline">
          {t("courses.toCatalog")}
        </Link>
      </EmptyState>
    );
  return (
    <>
      {(mine.length > 1 || filters.active) && filters.bar}
      {filters.shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filters.shown.map(({ c }) => (
            <MyCourseCard key={c.key} course={c} />
          ))}
        </div>
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
      <EmptyState className="text-foreground">
        <p className="text-lg">{t("courses.noneDownloaded")}</p>
        <Link to="/catalog" className="mt-3 inline-block font-medium underline">
          {t("courses.toCatalog")}
        </Link>
      </EmptyState>
    );
  return (
    <>
      {filters.bar}
      {filters.shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filters.shown.map((c) => (
            <CourseCard key={c.key} course={c.course} edition={c.edition} />
          ))}
        </div>
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
  const cards = (catalog.data ?? [])
    .filter((offer) => !offer.installed)
    .map((offer) => ({
      key: offer.key,
      offer,
      titles: [offer.title],
      editions: [offer.edition],
    }));
  const filters = useCourseFilters(cards, CATALOG_FILTERS, list.settings ?? {});
  if (!list.all) return list.state;
  if (catalog.isPending) return <Loading />;
  if (!cards.length)
    return (
      <EmptyState className="text-lg text-foreground">{t("courses.allDownloaded")}</EmptyState>
    );
  return (
    <>
      {filters.bar}
      {filters.shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filters.shown.map((c) => (
            <OfferCard key={c.key} offer={c.offer} />
          ))}
        </div>
      ) : (
        <EmptyState>{t("courses.noneMatch")}</EmptyState>
      )}
    </>
  );
}
