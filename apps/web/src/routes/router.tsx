// Routes (TanStack Router, code-based): app pages inside the shell, the lesson player full screen.
import type { LessonKey } from "@sprachanker/schema";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "@/api/session.ts";
import { usePlaybackRate, usePreferences } from "@/app/preferences.ts";
import { AppShell, type ExtraSection } from "@/app/shell.tsx";
import { WhoIsStudying } from "@/app/who-is-studying.tsx";
import { SpeechProvider } from "@/audio/context.ts";
import { useSpeechHostValue } from "@/audio/use-speech-host.ts";
import { useAiIn } from "@/llm/setup-api.ts";
import type { LessonView } from "@/notebook/lesson.tsx";
import { StudySlotsProvider } from "@/study/slots.ts";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { PlaybackRate } from "@/ui/playback.tsx";
import { CoursesPage } from "./courses.tsx";
import { ExamsPage } from "./exams.tsx";
import { opening, page, RouteError } from "./page.tsx";
import type { ReviewTab } from "./review.tsx";

const CoursePage = page(() => import("./course.tsx").then((m) => m.CoursePage));
const ReviewPage = page(() => import("./review.tsx").then((m) => m.ReviewPage));
const SettingsPage = page(() => import("./settings.tsx").then((m) => m.SettingsPage));
const ExamPage = page(() => import("@/exams/page.tsx").then((m) => m.ExamPage));
const ExamCatalog = page(() => import("@/exams/catalog.tsx").then((m) => m.ExamCatalog));
const NotebookPage = page(() => import("@/notebook/page.tsx").then((m) => m.NotebookPage));
const ExamNotebook = page(() => import("@/notebook/exam.tsx").then((m) => m.ExamNotebook));
const LessonNotebook = page(() => import("@/notebook/lesson.tsx").then((m) => m.LessonNotebook));
const ReviewDay = page(() => import("@/notebook/review-day.tsx").then((m) => m.ReviewDay));
const LessonRun = page(() => import("./runs.tsx").then((m) => m.LessonRun));
const ExamRun = page(() => import("./runs.tsx").then((m) => m.ExamRun));
const AssistantSetup = page(() =>
  import("@/llm/settings-section.tsx").then((m) => m.AssistantSetup),
);
const TutorSection = page(() => import("@/llm/tutor-section.tsx").then((m) => m.TutorSection));
const SectionChat = page(() => import("@/llm/tutor-section.tsx").then((m) => m.SectionChatPage));
/** The Tutor section in the navigation, while the assistant works there (09). */
const tutorSection: ExtraSection = {
  to: "/tutor",
  key: "nav.tutor",
  icon: MessageCircle,
  useShown: () => useAiIn("tutor"),
};
const Onboarding = page(() => import("@/app/onboarding.tsx").then((m) => m.Onboarding));
// The reviewer's and Decks' slots (a deck's AI examples, on a card and under the deck), loaded when
// first shown; nothing in their place meanwhile, so the card does not move.
const CardExamples = page(
  () => import("@/llm/word-examples.tsx").then((m) => m.examplesAssistant.word),
  null,
);
const CardCorner = page(
  () => import("@/llm/word-examples.tsx").then((m) => m.examplesAssistant.corner),
  null,
);
const DeckExamples = page(
  () => import("@/llm/word-examples.tsx").then((m) => m.examplesAssistant.deck),
  null,
);
const examplesAssistant = {
  word: (props: { cardId: string }) => <CardExamples {...props} />,
  corner: (props: { cardId: string; scope: string; audio: boolean }) => <CardCorner {...props} />,
  deck: (props: { scope: string; className?: string }) => <DeckExamples {...props} />,
};

/** The app of a signed-in, onboarded profile: its preferences applied. */
function SignedIn() {
  usePreferences();
  return (
    <PlaybackRate value={usePlaybackRate()}>
      <SpeechProvider value={useSpeechHostValue()}>
        <StudySlotsProvider value={examplesAssistant}>
          <Outlet />
        </StudySlotsProvider>
      </SpeechProvider>
    </PlaybackRate>
  );
}

// No profile on this device: who is studying, or a new profile's onboarding — its first step names it
// and makes it; a profile not yet onboarded: its onboarding (opened again for the new profile, at the
// step after naming it; with the AI assistant's settings as a step); else the app.
const root = createRootRoute({
  component: function Root() {
    const session = useSession();
    const navigate = useNavigate();
    const [adding, setAdding] = useState(false);
    /** The profile made by this onboarding: the one its Cancel may delete. */
    const [madeHere, setMadeHere] = useState<string>();
    const profile = session.data?.profile;
    // Signed in, the new profile is made: signed out later, the device shows who is studying again.
    useEffect(() => {
      if (!profile) return;
      if (adding) setMadeHere(profile.id);
      setAdding(false);
    }, [profile, adding]);
    if (session.isPending) return <Loading />;
    if (session.isError)
      return <ErrorState error={session.error} onRetry={() => session.refetch()} />;
    if (!profile && !adding) return <WhoIsStudying onNew={() => setAdding(true)} />;
    if (!profile?.onboarded)
      return (
        <Onboarding
          key={profile?.id ?? "new"}
          profile={profile ?? null}
          assistant={<AssistantSetup />}
          onBack={profile ? undefined : () => setAdding(false)}
          madeHere={!!profile && profile.id === madeHere}
          onDone={(to) => void navigate({ to })}
        />
      );
    return <SignedIn />;
  },
});
const shell = createRoute({
  getParentRoute: () => root,
  id: "shell",
  component: () => <AppShell extra={tutorSection} />,
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
  component: opening(CoursePage, function Course() {
    const params = course.useParams();
    return <CoursePage series={params.series} course={params.course} />;
  }),
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
  component: opening(ReviewPage, () => <Review tab="study" />),
});
const reviewDecks = createRoute({
  getParentRoute: () => shell,
  path: "/review/decks",
  component: opening(ReviewPage, () => <Review tab="decks" />),
});
const words = createRoute({
  getParentRoute: () => shell,
  path: "/review/words",
  component: opening(ReviewPage, () => <Review tab="words" />),
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
  component: opening(ExamPage, function Exam() {
    const params = exam.useParams();
    const { start } = exam.useSearch();
    return (
      <ExamPage
        key={`${params.series}/${params.course}/${params.exam}`}
        params={params}
        start={start}
      />
    );
  }),
});
const examCatalog = createRoute({
  getParentRoute: () => shell,
  path: "/exam/$series/$course/$exam/catalog",
});
examCatalog.update({
  component: opening(ExamCatalog, function Catalog() {
    return <ExamCatalog params={examCatalog.useParams()} />;
  }),
});
const examRun = createRoute({
  getParentRoute: () => root,
  path: "/exam/$series/$course/$exam/run/$run",
});
examRun.update({
  component: opening(ExamRun, function ExamRunPage() {
    const { run, ...params } = examRun.useParams();
    return <ExamRun key={run} params={params} runId={run} />;
  }),
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
  component: opening(ExamNotebook, function NotebookExam() {
    return <ExamNotebook params={notebookExam.useParams()} />;
  }),
});
// A review day in full; its neighbours open in its place, the Notebook going back.
const notebookReview = createRoute({
  getParentRoute: () => shell,
  path: "/notebook/review/$run",
});
notebookReview.update({
  component: opening(ReviewDay, function NotebookReviewDay() {
    const { run } = notebookReview.useParams();
    const navigate = notebookReview.useNavigate();
    return (
      <ReviewDay
        key={run}
        id={run}
        go={(next) =>
          void (next
            ? navigate({ to: "/notebook/review/$run", params: { run: next } })
            : navigate({ to: "/notebook" }))
        }
      />
    );
  }),
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
  component: opening(LessonNotebook, function NotebookLesson() {
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
  }),
});
// The Tutor section: its chats, and a chat (`new`: one not begun).
const tutor = createRoute({
  getParentRoute: () => shell,
  path: "/tutor",
  component: TutorSection,
});
const tutorChat = createRoute({ getParentRoute: () => shell, path: "/tutor/$chat" });
tutorChat.update({
  component: opening(SectionChat, function TutorChat() {
    return <SectionChat chat={tutorChat.useParams().chat} />;
  }),
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
  component: opening(LessonRun, function Lesson() {
    const params = lesson.useParams();
    const { step } = lesson.useSearch();
    const navigate = lesson.useNavigate();
    return (
      <LessonRun
        key={`${params.series}/${params.course}/${params.lesson}`}
        step={step}
        // Replaced, not pushed: the browser's back still leaves the lesson.
        onStep={(id) => void navigate({ search: { step: id }, replace: true })}
        {...params}
      />
    );
  }),
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
      notebookReview,
      notebookLesson,
      tutor,
      tutorChat,
      settings,
    ]),
    lesson,
    examRun,
  ]),
  // A page's chunk loaded ahead when a link to it is hovered or touched.
  defaultPreload: "intent",
  // A page that fails: our ErrorState, its Retry loading the app again (not TanStack's English one).
  defaultErrorComponent: RouteError,
  // A new page opens at its top; Back returns to where the page was left (a long list of courses).
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
