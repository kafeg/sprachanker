// Routes (TanStack Router, code-based): app pages inside the shell, the lesson player full screen.
import type { LessonKey } from "@sprachanker/schema";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { useSession } from "@/api/session.ts";
import { Onboarding } from "@/app/onboarding.tsx";
import { usePlaybackRate, usePreferences } from "@/app/preferences.ts";
import { AppShell } from "@/app/shell.tsx";
import { WhoIsStudying } from "@/app/who-is-studying.tsx";
import { SpeechProvider } from "@/audio/context.ts";
import { useSpeechHostValue } from "@/audio/use-speech-host.ts";
import { ExamCatalog } from "@/exams/catalog.tsx";
import { ExamPage } from "@/exams/page.tsx";
import { ExamPlayer } from "@/exams/player.tsx";
import { ExamSlotsProvider } from "@/exams/slots.ts";
import { LessonPlayer } from "@/lesson/player.tsx";
import { examAssistant } from "@/llm/exam-rating.tsx";
import { lessonAssistant } from "@/llm/lesson-assistant.tsx";
import { AssistantSetup } from "@/llm/settings-section.tsx";
import { wordAssistant } from "@/llm/word-example.tsx";
import { ExamNotebook } from "@/notebook/exam.tsx";
import { LessonNotebook, type LessonView } from "@/notebook/lesson.tsx";
import { NotebookPage } from "@/notebook/page.tsx";
import { StudySlotsProvider } from "@/study/slots.ts";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { PlaybackRate } from "@/ui/playback.tsx";
import { CoursePage } from "./course.tsx";
import { CoursesPage } from "./courses.tsx";
import { ExamsPage } from "./exams.tsx";
import { ReviewPage, type ReviewTab } from "./review.tsx";
import { SettingsPage } from "./settings.tsx";

/** The app of a signed-in, onboarded profile: its preferences applied. */
function SignedIn() {
  usePreferences();
  return (
    <PlaybackRate value={usePlaybackRate()}>
      <SpeechProvider value={useSpeechHostValue()}>
        <StudySlotsProvider value={wordAssistant}>
          <Outlet />
        </StudySlotsProvider>
      </SpeechProvider>
    </PlaybackRate>
  );
}

// No profile on this device: who is studying; a profile not yet onboarded: its onboarding (with the
// AI assistant's settings as a step); else the app.
const root = createRootRoute({
  component: function Root() {
    const session = useSession();
    const navigate = useNavigate();
    if (session.isPending) return <Loading />;
    if (session.isError)
      return <ErrorState error={session.error} onRetry={() => session.refetch()} />;
    const profile = session.data.profile;
    if (!profile) return <WhoIsStudying />;
    if (!profile.onboarded)
      return (
        <Onboarding
          profile={profile}
          assistant={<AssistantSetup />}
          onDone={() => void navigate({ to: "/catalog" })}
        />
      );
    return <SignedIn />;
  },
});
const shell = createRoute({
  getParentRoute: () => root,
  id: "shell",
  component: AppShell,
});
// Courses in three tabs, each its own address (Available keeps the old "/catalog").
const courses = createRoute({
  getParentRoute: () => shell,
  path: "/",
  component: () => <CoursesPage tab="mine" />,
});
const downloaded = createRoute({
  getParentRoute: () => shell,
  path: "/downloaded",
  component: () => <CoursesPage tab="downloaded" />,
});
const catalog = createRoute({
  getParentRoute: () => shell,
  path: "/catalog",
  component: () => <CoursesPage tab="available" />,
});
const course = createRoute({ getParentRoute: () => shell, path: "/course/$series/$course" });
course.update({
  component: function Course() {
    const params = course.useParams();
    return <CoursePage series={params.series} course={params.course} />;
  },
});
// Review in three tabs, each its own address.
function Review({ tab }: { tab: ReviewTab }) {
  const navigate = useNavigate();
  return (
    <ReviewPage
      tab={tab}
      go={(next) =>
        void navigate({
          to: next === "study" ? "/review" : next === "decks" ? "/review/decks" : "/review/words",
        })
      }
    />
  );
}
const review = createRoute({
  getParentRoute: () => shell,
  path: "/review",
  component: () => <Review tab="study" />,
});
const reviewDecks = createRoute({
  getParentRoute: () => shell,
  path: "/review/decks",
  component: () => <Review tab="decks" />,
});
const words = createRoute({
  getParentRoute: () => shell,
  path: "/review/words",
  component: () => <Review tab="words" />,
});
const exams = createRoute({
  getParentRoute: () => shell,
  path: "/exams",
  component: () => <ExamsPage tab="mine" />,
});
const examsDownloaded = createRoute({
  getParentRoute: () => shell,
  path: "/exams/downloaded",
  component: () => <ExamsPage tab="downloaded" />,
});
const examsCatalog = createRoute({
  getParentRoute: () => shell,
  path: "/exams/catalog",
  component: () => <ExamsPage tab="available" />,
});
const exam = createRoute({
  getParentRoute: () => shell,
  path: "/exam/$series/$course/$exam",
  // Asked from a card: begin a mock exam or practice at once (the state chosen first if need be).
  validateSearch: (s: Record<string, unknown>): { start?: "test" | "practice" } =>
    s.start === "test" || s.start === "practice" ? { start: s.start } : {},
});
exam.update({
  component: function Exam() {
    const params = exam.useParams();
    const { start } = exam.useSearch();
    return (
      <ExamPage
        key={`${params.series}/${params.course}/${params.exam}`}
        params={params}
        start={start}
      />
    );
  },
});
const examCatalog = createRoute({
  getParentRoute: () => shell,
  path: "/exam/$series/$course/$exam/catalog",
});
examCatalog.update({
  component: function Catalog() {
    return <ExamCatalog params={examCatalog.useParams()} />;
  },
});
const examRun = createRoute({
  getParentRoute: () => root,
  path: "/exam/$series/$course/$exam/run/$run",
});
examRun.update({
  component: function ExamRun() {
    const { run, ...params } = examRun.useParams();
    return (
      <ExamSlotsProvider value={examAssistant}>
        <ExamPlayer key={run} params={params} runId={run} />
      </ExamSlotsProvider>
    );
  },
});
const notebook = createRoute({
  getParentRoute: () => shell,
  path: "/notebook",
  component: NotebookPage,
});
const notebookExam = createRoute({
  getParentRoute: () => shell,
  path: "/notebook/exam/$series/$course/$exam",
});
notebookExam.update({
  component: function NotebookExam() {
    return <ExamNotebook params={notebookExam.useParams()} />;
  },
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
      downloaded,
      catalog,
      course,
      review,
      reviewDecks,
      words,
      exams,
      examsDownloaded,
      examsCatalog,
      exam,
      examCatalog,
      notebook,
      notebookExam,
      notebookLesson,
      settings,
    ]),
    lesson,
    examRun,
  ]),
  defaultPreload: "intent",
  // A new page opens at its top; Back returns to where the page was left (a long list of courses).
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
