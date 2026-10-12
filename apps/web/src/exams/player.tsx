// An exam run (owner's choice B, 2026-10-10): a question at a time as an online test shows
// it, the grid of the run's numbers above (by Teil) to go to any, the Teil's material — its text,
// recording, picture, example — with its every question (beside it on a wide screen). A mock exam runs
// as the real test does — the time left above, answers that can be changed until it is handed in,
// nothing checked before (then the result, 4B), Next in the step bar; practice (D) as a lesson: an
// answer kept until Check in the step bar sends it and shows it checked, then Next; Skip passes a
// question by; its tally above.
import { answerComplete, checkQuestion, contentPoints, questionLine } from "@sprachanker/engine";
import {
  type Exam,
  type ExamItem,
  examLang,
  type LocaleExam,
  type Outcome,
  type RespondAnswer,
  type TypedEvent,
} from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Timer } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, mediaUrl } from "@/api/client.ts";
import { useExamPage, useExamRun, useKeepRunEvents } from "@/api/exams.ts";
import { CourseGone } from "@/library/course-gone.tsx";
import { type ExamParams, examKeyOf } from "@/library/exam-address.ts";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { clock } from "@/ui/format.ts";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { SIDE_BACK, SideHeader, SideLayout } from "@/ui/side-layout.tsx";
import { StepBack, StepNext } from "@/ui/step-buttons.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { useWindowPlace } from "@/ui/window-title.ts";
import { type ListedQuestion, QuestionList } from "./navigator.tsx";
import { examExercise, inTeile, latestAnswers, takesOf } from "./questions.ts";
import { OpenAnswerRating } from "./rating.tsx";
import { ExamResultView } from "./result.tsx";
import { questionState, runTally, useQuestionPlace, useTimeLeft } from "./run-state.ts";
import { useExamSlots } from "./slots.ts";
import { QuestionCard, TeilHeader, TeilMaterial } from "./teil.tsx";

export function ExamPlayer({ params, runId }: { params: ExamParams; runId: string }) {
  const navigate = useNavigate();
  const key = examKeyOf(params);
  const { query, answer, finish, eventsNow } = useExamRun(runId);
  const run = query.data?.run;
  const page = useExamPage(key, run?.edition ?? undefined);
  const toExam = () => void navigate({ to: "/exam/$series/$course/$exam", params });

  if (query.isPending || (run && page.isPending)) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  // Its course removed: said so, with its offer (the run waits for it).
  if (page.error instanceof ApiError && page.error.message === "not_installed")
    return <CourseGone series={params.series} course={params.course} kind="exam" />;
  if (page.isError) return <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  if (!run || !page.data) return <Loading />;
  const target = examLang(run.edition);
  const exam = page.data.exam;
  // A mock exam's questions as they were shown; practice's as installed now.
  const items =
    run.plan.snapshot ?? run.plan.items.flatMap((k) => exam.items.find((i) => i.key === k) ?? []);
  const title = page.data.locale?.title ?? key;
  return (
    <TargetLang value={target}>
      {run.status === "active" ? (
        <Running
          runId={run.id}
          title={title}
          exam={exam}
          locale={page.data.locale}
          sectionOf={run.plan.sections}
          module={run.plan.module}
          items={items}
          events={query.data?.events ?? []}
          mode={run.plan.mode}
          deadline={run.plan.deadline}
          skew={query.data?.skew ?? 0}
          series={params.series}
          lang={target}
          onAnswer={answer}
          eventsNow={eventsNow}
          finishing={finish.isPending}
          onFinish={() => finish.mutate()}
          onLeave={toExam}
        />
      ) : (
        <ExamResultView
          title={title}
          params={params}
          run={run}
          exam={exam}
          locale={page.data.locale}
          items={items}
          events={query.data?.events ?? []}
          onLeave={toExam}
        />
      )}
    </TargetLang>
  );
}

function Running({
  runId,
  title,
  exam,
  locale,
  sectionOf,
  module,
  items,
  events,
  mode,
  deadline,
  skew,
  series,
  lang,
  onAnswer,
  eventsNow,
  finishing,
  onFinish,
  onLeave,
}: {
  runId: string;
  title: string;
  exam: Exam;
  locale: LocaleExam | null;
  sectionOf: Record<string, string>;
  /** The one module taken, if so. */
  module?: string;
  items: ExamItem[];
  events: TypedEvent[];
  mode: "test" | "practice";
  deadline: number | null;
  /** The server's clock ahead of this device's (ms): the deadline is the server's. */
  skew: number;
  series: string;
  lang: string;
  onAnswer(itemKey: string, answer: unknown, ms: number, outcome?: Outcome): void;
  /** The answers as they are when asked (a typed one taken as the page is left). */
  eventsNow(): TypedEvent[];
  finishing: boolean;
  onFinish(): void;
  onLeave(): void;
}) {
  const { t } = useTranslation();
  useWindowPlace(title);
  const answers = useMemo(() => latestAnswers(events), [events]);
  // A speaking part said from its script while the assistant works here (exams/slots.ts).
  const slots = useExamSlots();
  const conversing = slots.conversation?.useOn() ?? false;
  const keep = useKeepRunEvents(runId);
  /** Questions left unanswered, asked about before handing in (0: not asking). */
  const [confirm, setConfirm] = useState(0);
  /** Practice: each question's answer as given so far, until Check sends it. */
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const teile = useMemo(() => inTeile(exam, items, sectionOf), [exam, items, sectionOf]);
  const url = (path: string) => mediaUrl(series, path);
  const moduleTitle = (m?: string) => (m ? (locale?.modules?.[m]?.title ?? m) : undefined);

  const { current, go, shownAt } = useQuestionPlace(runId, items, answers);

  const { answered, right, wrong } = runTally(items, answers);
  const stateOf = (key: string) => questionState(answers.get(key), mode);
  // The plan: every question with its Teil's title (a heading where it changes; practice goes in
  // order of need, so its Teile may come again).
  // biome-ignore lint/correctness/useExhaustiveDependencies: stateOf and moduleTitle read answers and locale
  const listed: ListedQuestion[] = useMemo(
    () =>
      teile.map(({ item, section }, index) => {
        const teilTitle = section ? locale?.sections[section.key]?.title : undefined;
        const group = [moduleTitle(section?.module), teilTitle].filter(Boolean).join(" · ");
        return {
          index,
          state: stateOf(item.key),
          line: questionLine(item, section),
          ...(teile.length > 1 && group && { group }),
        };
      }),
    [teile, answers, mode, items, locale],
  );

  // The time left; at its end the exam is handed in as it is.
  const handedIn = useRef(false);
  const handIn = () => {
    if (handedIn.current) return;
    handedIn.current = true;
    onFinish();
  };
  const left = useTimeLeft(deadline, skew, handIn);

  const finishLabel = mode === "test" ? t("exams.handIn") : t("exams.endPractice");
  // Unanswered questions are asked about first; counted when pressed — a typed answer is taken as
  // its field is left, a moment before.
  const askFinish = () => {
    const now = latestAnswers(eventsNow());
    const missing = items.filter((i) => !now.has(i.key)).length;
    if (mode === "test" && missing > 0) setConfirm(missing);
    else handIn();
  };

  const here = teile[current] ?? teile[0];
  if (!here) return null;
  const { item, section } = here;
  const given = answers.get(item.key);
  const last = current === items.length - 1;
  // A Teil's first question shows its example open; the others keep it folded.
  const firstOfTeil = teile.findIndex((x) => x.section?.key === section?.key) === current;
  // Long material (a text to read, the ads or pictures answered by letter) beside the question.
  const beside =
    !!section &&
    ((section.text?.length ?? 0) > 400 ||
      (!!section.text && !!section.media?.image) ||
      (section.letters?.length ?? 0) > 0);

  // When this question came: an answer given after it is left (a take heard late) is timed from it.
  const shown = shownAt.current;
  const send = (value: unknown) => {
    // Nothing more once the exam is being handed in (a draft taken as the page goes).
    if (handedIn.current || finishing) return;
    onAnswer(
      item.key,
      value,
      Date.now() - shown,
      mode === "practice" ? checkQuestion(item, value, lang) : undefined,
    );
  };
  const label = t("exams.question", { n: current + 1, total: items.length });
  // A speaking part said through from its script while the assistant works here: practice keeps it
  // as the draft Check sends, then shows it answered with the script's good lines; a mock exam keeps
  // it as the answer as soon as every place is said (and anew when said again).
  // Answered from a script (line by line), or not answered yet: an answer given otherwise (before
  // scripts, or without the assistant) is shown as any open answer.
  const givenLines = (given?.answer as RespondAnswer | undefined)?.lines;
  const spokenPart =
    conversing && item.type === "respond" && item.input === "speech" && (!given || givenLines)
      ? slots.conversation?.view({
          runId,
          itemKey: item.key,
          events,
          onStored: keep,
          onSaid: (said) => {
            if (mode === "test") {
              if (said) send(said);
            } else setDrafts((d) => ({ ...d, [item.key]: said }));
          },
          hints: mode === "practice",
          said: (given?.answer as RespondAnswer | undefined) ?? (drafts[item.key] as RespondAnswer),
          checked: mode === "practice" && !!given,
        })
      : undefined;
  const conversation = spokenPart ?? undefined;
  // Practice: a question not answered yet waits for Check, as a lesson's does.
  const checking = mode === "practice" && !given;
  const draft = drafts[item.key];
  const ready =
    checking &&
    (conversation ? draft !== undefined : answerComplete(examExercise(item, false), 0, draft));
  const question = conversation ? (
    <section key={item.key} aria-label={label}>
      <p className="mb-1.5 text-sm text-muted-foreground">{label}</p>
      {item.prompt && <p className="mb-3 font-semibold">{item.prompt}</p>}
      {conversation}
    </section>
  ) : (
    <QuestionCard
      key={item.key}
      item={item}
      label={label}
      plays={mode === "test" ? section?.plays : undefined}
      {...(checking && {
        draft: drafts[item.key],
        onDraft: (a: unknown) => setDrafts((d) => ({ ...d, [item.key]: a })),
      })}
      active
      run={runId}
      answer={given?.answer}
      // Practice shows each answer checked; a mock exam none until handed in.
      outcome={mode === "practice" ? given?.outcome : undefined}
      url={url}
      onAnswer={mode === "practice" && given ? undefined : send}
    />
  );
  // Practice rates an open answer once it is given: the assistant goes over it at once (its proposal),
  // the learner takes it or rates by the criteria.
  const rating = mode === "practice" && item.criteria && given && (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium">{t("exams.rating.title")}</p>
      <OpenAnswerRating
        key={item.key}
        runId={runId}
        item={{ ...item, criteria: item.criteria }}
        locale={locale?.items[item.key as keyof typeof locale.items]}
        events={events}
        answer={(given.answer as { text?: string }).text ?? ""}
        points={contentPoints(section && locale?.sections[section.key]?.instructions)}
        takes={takesOf(given.answer)}
        auto
      />
    </div>
  );
  const header = section && (
    <TeilHeader
      section={section}
      locale={locale}
      module={moduleTitle(section.module)}
      examples={(section.examples ?? []).flatMap((k) => exam.items.find((i) => i.key === k) ?? [])}
      examplesOpen={mode === "test" && firstOfTeil}
      withMaterial={!beside}
      limited={mode === "test"}
      run={runId}
      url={url}
    />
  );
  const moves = (
    <>
      <StepBack
        label={t("exams.previous")}
        onClick={() => go(current - 1)}
        disabled={current === 0}
      />
      {checking ? (
        <div className="flex items-center gap-2">
          {!last && (
            <Button variant="ghost" size="lg" onClick={() => go(current + 1)}>
              {t("lesson.skip")}
            </Button>
          )}
          <StepNext disabled={!ready} onClick={() => send(draft)}>
            {t("lesson.check")}
          </StepNext>
        </div>
      ) : last ? (
        <StepNext loading={finishing} onClick={askFinish}>
          {finishLabel}
        </StepNext>
      ) : (
        // Outlined while the question has no answer: a cue that it is left unanswered.
        <StepNext variant={given ? "default" : "outline"} onClick={() => go(current + 1)}>
          {t("exams.next")}
        </StepNext>
      )}
    </>
  );

  const side = (picked?: () => void) => (
    <>
      <SideHeader
        back={
          <button type="button" onClick={onLeave} className={SIDE_BACK}>
            <ArrowLeft className="rtl:-scale-x-100 size-4 shrink-0" />{" "}
            <span className="truncate">{t("exams.leave")}</span>
          </button>
        }
        title={module ? `${title} · ${moduleTitle(module)}` : title}
        status={
          mode === "test"
            ? t("exams.answered", { done: answered, total: items.length })
            : t("exams.practiceTally", { right, wrong, total: items.length })
        }
      />
      <QuestionList
        questions={listed}
        current={current}
        lang={lang}
        onGo={(index) => {
          go(index);
          picked?.();
        }}
      />
    </>
  );

  return (
    <>
      <SideLayout
        side={side}
        sideLabel={t("exams.questionsGrid")}
        width={beside ? "max-w-6xl" : "max-w-3xl"}
        bar={
          <>
            <Progress value={(answered / items.length) * 100} className="h-2 flex-1" />
            <span className="text-sm tabular-nums text-muted-foreground">
              {answered}/{items.length}
            </span>
            {left !== undefined && (
              <span className="flex items-center gap-1 font-heading text-lg font-bold tabular-nums">
                <Timer className="size-4" /> {clock(Math.ceil(left / 1000))}
              </span>
            )}
            <Button size="sm" variant="outline" loading={finishing} onClick={askFinish}>
              {finishLabel}
            </Button>
          </>
        }
      >
        <main className="pb-20 sm:pb-0">
          {beside && section ? (
            <div className="grid gap-6 xl:grid-cols-2">
              {/* On a phone the question comes first, what it is about under it; on a wide screen the
                  material is beside it, on the left as on the paper. */}
              <div className="order-2 xl:sticky xl:top-20 xl:order-1 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
                <TeilMaterial section={section} locale={locale} url={url} />
              </div>
              <div className="order-1 xl:order-2">
                {header}
                {question}
                {rating}
              </div>
            </div>
          ) : (
            <>
              {header}
              {question}
              {rating}
            </>
          )}
          <div className="mt-6 hidden justify-between gap-3 sm:flex">{moves}</div>
        </main>
      </SideLayout>
      <footer className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        {moves}
      </footer>
      <ConfirmDialog
        open={confirm > 0}
        onOpenChange={(open) => !open && setConfirm(0)}
        title={t("exams.handInTitle")}
        description={t("exams.handInUnanswered", { count: confirm })}
        confirm={t("exams.handIn")}
        cancel={t("exams.goOn")}
        busy={finishing}
        onConfirm={() => {
          setConfirm(0);
          handIn();
        }}
      />
    </>
  );
}
