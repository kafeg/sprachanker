// Routes (TanStack Router, code-based): app pages inside the shell, the lesson player full screen.
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { usePlaybackRate, usePreferences } from "@/app/preferences.ts";
import { LessonPlayer } from "@/lesson/player.tsx";
import { AssistantLabel } from "@/llm/assistant-label.tsx";
import { AppShell } from "@/ui/app-shell.tsx";
import { PlaybackRate } from "@/ui/media.tsx";
import { CoursePage } from "./course.tsx";
import { CatalogPage, MyCoursesPage } from "./courses.tsx";
import { SettingsPage } from "./settings.tsx";

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
  component: () => <AppShell footer={<AssistantLabel />} />,
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
const settings = createRoute({
  getParentRoute: () => shell,
  path: "/settings",
  component: SettingsPage,
});
const lesson = createRoute({ getParentRoute: () => root, path: "/lesson/$series/$course/$lesson" });
lesson.update({
  component: function Lesson() {
    const params = lesson.useParams();
    return <LessonPlayer key={`${params.series}/${params.course}/${params.lesson}`} {...params} />;
  },
});

export const router = createRouter({
  routeTree: root.addChildren([shell.addChildren([courses, catalog, course, settings]), lesson]),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
