// Courses (09): "My courses" — the ones started, ready to continue — and "All courses" — every installed
// course and those offered, narrowed by the pair and course filters. A course teaches one language to
// speakers of one language (its edition); another pair of the same source course is a course of its own.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCatalog, useCourses, useSettings } from "@/api/hooks.ts";
import {
  type CatalogEntry,
  CourseCard,
  type CourseRow,
  MyCourseCard,
  OfferCard,
} from "@/courses/card.tsx";
import { CATALOG_FILTERS, MY_FILTERS, useCourseFilters } from "@/courses/filters.tsx";
import { EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";

function useCourseList() {
  const courses = useCourses();
  const settings = useSettings();
  if (courses.isPending || settings.isPending) return { state: <Loading /> };
  if (courses.isError)
    return { state: <ErrorState error={courses.error} onRetry={() => courses.refetch()} /> };
  return { all: courses.data, settings: settings.data ?? {} };
}

export function MyCoursesPage() {
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
  return (
    <Page title={t("nav.myCourses")}>
      {(mine.length > 1 || filters.active) && filters.bar}
      {mine.length ? (
        filters.shown.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filters.shown.map(({ c }) => (
              <MyCourseCard key={c.key} course={c} />
            ))}
          </div>
        ) : (
          <EmptyState>{t("courses.noneMatch")}</EmptyState>
        )
      ) : (
        <EmptyState className="text-foreground">
          <p className="text-lg">{t("courses.noneStarted")}</p>
          <Link to="/catalog" className="mt-3 inline-block font-medium underline">
            {t("courses.toCatalog")}
          </Link>
        </EmptyState>
      )}
    </Page>
  );
}

export function CatalogPage() {
  const { t } = useTranslation();
  const list = useCourseList();
  const catalog = useCatalog();
  const all = list.all ?? [];
  // Installed courses, then those offered but not downloaded yet (the providers' catalogues).
  const cards: Array<{
    key: string;
    edition: string;
    titles: string[];
    editions: string[];
    course?: CourseRow;
    offer?: CatalogEntry;
  }> = [
    ...all.flatMap((course) =>
      course.editions.map((edition) => ({
        key: `${course.key}:${edition}`,
        course,
        edition,
        titles: [course.titles[edition] || course.key],
        editions: [edition],
      })),
    ),
    ...(catalog.data ?? [])
      .filter((offer) => !offer.installed)
      .map((offer) => ({
        key: offer.key,
        offer,
        edition: offer.edition,
        titles: [offer.title],
        editions: [offer.edition],
      })),
  ];
  const filters = useCourseFilters(cards, CATALOG_FILTERS, list.settings ?? {});
  if (!list.all) return list.state;
  if (!cards.length)
    return (
      <Page title={t("nav.allCourses")}>
        <EmptyState className="text-lg text-foreground">{t("courses.empty")}</EmptyState>
      </Page>
    );
  return (
    <Page title={t("nav.allCourses")}>
      {filters.bar}
      {filters.shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filters.shown.map((c) =>
            c.course ? (
              <CourseCard key={c.key} course={c.course} edition={c.edition} />
            ) : c.offer ? (
              <OfferCard key={c.key} offer={c.offer} />
            ) : null,
          )}
        </div>
      ) : (
        <EmptyState>{t("courses.noneMatch")}</EmptyState>
      )}
    </Page>
  );
}
