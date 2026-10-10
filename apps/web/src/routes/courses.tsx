// Courses (09): one page in three tabs — My courses (started, ready to continue), Downloaded (installed,
// started or not) and Available (every course a provider offers that is not here yet) — each narrowed by
// the pair and course filters. A course teaches one language to speakers of one language (its edition);
// another pair of the same source course is a course of its own.
import { useTranslation } from "react-i18next";
import { useCatalog, useCourses } from "@/api/courses.ts";
import { useSettings } from "@/api/settings.ts";
import { offersOf, useShown } from "@/app/experimental.ts";
import { CourseCard, MyCourseCard } from "@/courses/card.tsx";
import { FILTERS, useCourseFilters } from "@/courses/filters.tsx";
import { OfferCard } from "@/library/card.tsx";
import { CardGrid, type LibraryTab, LibraryTabPage, NoneHere } from "@/library/tab-page.tsx";
import { EmptyState, ErrorState, Loading } from "@/ui/page.tsx";

type CoursesTab = LibraryTab;
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
  if (!list.all) return list.state;
  const mine = list.all.filter((c) => c.started);
  if (!mine.length)
    return (
      <NoneHere
        text={t("courses.noneStarted")}
        link={{ to: "/catalog", label: t("courses.toCatalog") }}
      />
    );
  return (
    <FilteredCards
      tab="mine"
      settings={list.settings}
      cards={mine.map((course) => ({
        key: course.key,
        course,
        titles: course.editions.map((e) => course.titles[e] || course.key),
        editions: course.editions,
      }))}
      card={(c) => <MyCourseCard key={c.key} course={c.course} />}
    />
  );
}

function Downloaded() {
  const { t } = useTranslation();
  const list = useCourseList();
  if (!list.all) return list.state;
  // Each edition of an installed course is a card of its own.
  const cards = list.all.flatMap((course) =>
    course.editions.map((edition) => ({
      key: `${course.key}:${edition}`,
      course,
      edition,
      titles: [course.titles[edition] || course.key],
      editions: [edition],
    })),
  );
  if (!cards.length)
    return (
      <NoneHere
        text={t("courses.noneDownloaded")}
        link={{ to: "/catalog", label: t("courses.toCatalog") }}
      />
    );
  return (
    <FilteredCards
      tab="downloaded"
      settings={list.settings}
      cards={cards}
      card={(c) => <CourseCard key={c.key} course={c.course} edition={c.edition} upkeep />}
    />
  );
}

function Available() {
  const { t } = useTranslation();
  const list = useCourseList();
  const catalog = useCatalog();
  const { shown } = useShown();
  if (!list.all) return list.state;
  // Not "all downloaded" when the catalogue failed (while it loads, the list waits: useShown).
  if (catalog.isError)
    return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;
  const cards = offersOf(catalog.data, "courses", shown).map((offer) => ({
    key: offer.key,
    offer,
    titles: [offer.title],
    editions: [offer.edition],
  }));
  if (!cards.length) return <NoneHere text={t("courses.allDownloaded")} />;
  return (
    <FilteredCards
      tab="available"
      settings={list.settings}
      cards={cards}
      card={(c) => <OfferCard key={c.key} offer={c.offer} />}
    />
  );
}

/** A tab's cards narrowed by its two filters; the bar shows while there is a choice or a filter set. */
function FilteredCards<T extends { titles: string[]; editions: string[] }>({
  tab,
  cards,
  settings,
  card,
}: {
  tab: CoursesTab;
  cards: T[];
  settings: Record<string, unknown>;
  card(item: T): React.ReactNode;
}) {
  const { t } = useTranslation();
  const filters = useCourseFilters(cards, FILTERS[tab], settings);
  return (
    <>
      {(cards.length > 1 || filters.active) && filters.bar}
      {filters.shown.length ? (
        <CardGrid>{filters.shown.map(card)}</CardGrid>
      ) : (
        <EmptyState>{t("courses.noneMatch")}</EmptyState>
      )}
    </>
  );
}
