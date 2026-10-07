// Routes (TanStack Router, code-based): app pages inside the shell, the lesson player full screen.
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { usePlaybackRate, usePreferences } from "@/app/preferences.ts";
import { LessonPlayer } from "@/lesson/player.tsx";
import { lessonAssistant } from "@/llm/lesson-assistant.tsx";
import { AppShell } from "@/ui/app-shell.tsx";
import { PlaybackRate } from "@/ui/media.tsx";
import { CoursePage } from "./course.tsx";
import { CatalogPage, MyCoursesPage } from "./courses.tsx";
import { ReviewPage } from "./review.tsx";
import { SettingsPage } from "./settings.tsx";
import { WordsPage } from "./words.tsx";

const root = createRootRoute({
  component: function Root() {
    usePreferences();
    return (
      <PlaybackRate value={usePlaybackRate()}>
        <Outlet />
      </PlaybackRate>
    );
  },
});
const shell = createRoute({
  getParentRoute: () => root,
  id: "shell",
  component: AppShell,
});
const courses = createRoute({ getParentRoute: () => shell, path: "/", component: MyCoursesPage });
const catalog = createRoute({
  getParentRoute: () => shell,
  path: "/catalog",
  component: CatalogPage,
});
const course = createRoute({ getParentRoute: () => shell, path: "/course/$series/$course" });
course.update({
  component: function Course() {
    const params = course.useParams();
    return <CoursePage series={params.series} course={params.course} />;
  },
});
const review = createRoute({
  getParentRoute: () => shell,
  path: "/review",
  // Review opens on the cards; `decks` shows the deck list instead.
  validateSearch: (s: Record<string, unknown>): { decks?: boolean } => ({
    ...((s.decks === true || s.decks === "true") && { decks: true }),
  }),
});
review.update({
  component: function Review() {
    const search = review.useSearch();
    const navigate = review.useNavigate();
    return <ReviewPage showDecks={!!search.decks} go={(next) => void navigate({ search: next })} />;
  },
});
const words = createRoute({
  getParentRoute: () => shell,
  path: "/review/words",
  component: function Words() {
    const navigate = words.useNavigate();
    return <WordsPage back={() => void navigate({ to: "/review", search: { decks: true } })} />;
  },
});
const settings = createRoute({
  getParentRoute: () => shell,
  path: "/settings",
  component: SettingsPage,
});
const lesson = createRoute({ getParentRoute: () => root, path: "/lesson/$series/$course/$lesson" });
lesson.update({
  component: function Lesson() {
    const params = lesson.useParams();
    return (
      <LessonPlayer
        key={`${params.series}/${params.course}/${params.lesson}`}
        slots={lessonAssistant}
        {...params}
      />
    );
  },
});

export const router = createRouter({
  routeTree: root.addChildren([
    shell.addChildren([courses, catalog, course, review, words, settings]),
    lesson,
  ]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
