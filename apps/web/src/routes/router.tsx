// Routes (TanStack Router, code-based): app pages inside the shell, the lesson player full screen.
import type { LessonKey } from "@sprachanker/schema";
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { usePlaybackRate, usePreferences } from "@/app/preferences.ts";
import { AppShell } from "@/app/shell.tsx";
import { LessonPlayer } from "@/lesson/player.tsx";
import { lessonAssistant } from "@/llm/lesson-assistant.tsx";
import { LessonNotebook, type LessonView } from "@/notebook/lesson.tsx";
import { NotebookPage } from "@/notebook/page.tsx";
import { PlaybackRate } from "@/ui/playback.tsx";
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
const notebook = createRoute({
  getParentRoute: () => shell,
  path: "/notebook",
  component: NotebookPage,
});
const notebookLesson = createRoute({
  getParentRoute: () => shell,
  path: "/notebook/$series/$course/$lesson",
  // A pass opened (`pass`) or two compared (`compare`: "<run>,<run>"); else the lesson's passes.
  validateSearch: (s: Record<string, unknown>): LessonView => ({
    ...(typeof s.pass === "string" && { pass: s.pass }),
    ...(typeof s.compare === "string" && { compare: s.compare }),
  }),
});
notebookLesson.update({
  component: function NotebookLesson() {
    const params = notebookLesson.useParams();
    const search = notebookLesson.useSearch();
    const navigate = notebookLesson.useNavigate();
    return (
      <LessonNotebook
        lessonKey={`${params.series}/${params.course}/${params.lesson}` as LessonKey}
        view={search}
        go={(view) => void (view ? navigate({ search: view }) : navigate({ to: "/notebook" }))}
      />
    );
  },
});
const settings = createRoute({
  getParentRoute: () => shell,
  path: "/settings",
  component: SettingsPage,
});
const lesson = createRoute({
  getParentRoute: () => root,
  path: "/lesson/$series/$course/$lesson",
  // The step shown, so a reload stays on it; without one the lesson resumes where it was left.
  validateSearch: (s: Record<string, unknown>): { step?: string } =>
    typeof s.step === "string" ? { step: s.step } : {},
});
lesson.update({
  component: function Lesson() {
    const params = lesson.useParams();
    const { step } = lesson.useSearch();
    const navigate = lesson.useNavigate();
    return (
      <LessonPlayer
        key={`${params.series}/${params.course}/${params.lesson}`}
        slots={lessonAssistant}
        step={step}
        // Replaced, not pushed: the browser's back still leaves the lesson.
        onStep={(id) => void navigate({ search: { step: id }, replace: true })}
        {...params}
      />
    );
  },
});

export const router = createRouter({
  routeTree: root.addChildren([
    shell.addChildren([
      courses,
      catalog,
      course,
      review,
      words,
      notebook,
      notebookLesson,
      settings,
    ]),
    lesson,
  ]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
