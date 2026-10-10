// An exam run (09, Exams; owner's choice B, 2026-10-10): a question at a time as an online test shows
// it, the grid of the run's numbers above (by Teil) to go to any, the Teil's material — its text,
// recording, picture, example — with its every question (beside it on a wide screen). A mock exam runs
// as the real test does — the time left above, answers that can be changed until it is handed in,
// nothing checked before (then the result, 4B); practice (D) checks each answer at once, its tally
// above.
import { checkQuestion, questionLine } from "@sprachanker/engine";
import {
  type Exam,
  type ExamItem,
  examLang,
  type LocaleExam,
  type Outcome,
  type TypedEvent,
} from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useExamPage, useExamRun, useKeepRunEvents } from "@/api/exams.ts";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { ConfirmDialog } from "@/ui/confirm.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { SideLayout } from "@/ui/side-layout.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { useWindowPlace } from "@/ui/window-title.ts";
import { type ListedQuestion, QuestionList } from "./navigator.tsx";
import { type ExamParams, examKeyOf } from "./params.ts";
import { inTeile, latestAnswers } from "./questions.ts";
import { OpenAnswerRating } from "./rating.tsx";
import { ExamResultView } from "./result.tsx";
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

/** Minutes and seconds left ("41:12"). */
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Where a run was left on this device (a reload comes back to its question). */
const placeKey = (run: string) => `sprachanker.exam-place:${run}`;
const readPlace = (run: string) => {
  try {
    return Number(sessionStorage.getItem(placeKey(run)) ?? Number.NaN);
  } catch {
    return Number.NaN;
  }
};
const writePlace = (run: string, index: number) => {
  try {
    sessionStorage.setItem(placeKey(run), String(index));
  } catch {
    // Storage blocked: a reload starts at the first open question.
  }
};

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
  // A speaking part held as a conversation while the assistant works here (exams/slots.ts).
  const slots = useExamSlots();
  const conversing = slots.conversation?.useOn() ?? false;
  const keep = useKeepRunEvents(runId);
  /** Questions left unanswered, asked about before handing in (0: not asking). */
  const [confirm, setConfirm] = useState(0);
  const teile = useMemo(() => inTeile(exam, items, sectionOf), [exam, items, sectionOf]);
  const url = (path: string) => mediaUrl(series, path);
  const moduleTitle = (m?: string) => (m ? (locale?.modules?.[m]?.title ?? m) : undefined);

  // The question on screen: where this device left the run, else the first one not answered.
  const [current, setCurrent] = useState(() => {
    const kept = readPlace(runId);
    if (kept >= 0 && kept < items.length) return kept;
    const open = items.findIndex((i) => !answers.has(i.key));
    return open < 0 ? 0 : open;
  });
  const shownAt = useRef(Date.now());
  const go = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setCurrent(next);
    writePlace(runId, next);
    shownAt.current = Date.now();
    window.scrollTo({ top: 0 });
  };
  // ← and → move between questions (not while typing an answer).
  const moveBy = useRef((_: number) => {});
  moveBy.current = (step: number) => go(current + step);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, [contenteditable]") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === "ArrowRight") moveBy.current(1);
      if (e.key === "ArrowLeft") moveBy.current(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const answered = items.filter((i) => answers.has(i.key)).length;
  const right = items.filter((i) => answers.get(i.key)?.outcome?.result === "correct").length;
  const wrong = items.filter((i) => {
    const o = answers.get(i.key)?.outcome;
    return o && o.result !== "correct" && o.result !== "unscored";
  }).length;
  const stateOf = (key: string) => {
    const given = answers.get(key);
    if (!given) return "open" as const;
    if (mode === "practice" && given.outcome && given.outcome.result !== "unscored")
      return given.outcome.result === "correct" ? ("right" as const) : ("wrong" as const);
    return "answered" as const;
  };
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
          line: questionLine(item),
          ...(teile.length > 1 && group && { group }),
        };
      }),
    [teile, answers, mode, items, locale],
  );

  // The time left, each second; at its end the exam is handed in as it is.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  const left = deadline === null ? undefined : deadline - (now + skew);
  const handedIn = useRef(false);
  useEffect(() => {
    if (left !== undefined && left <= 0 && !handedIn.current) {
      handedIn.current = true;
      onFinish();
    }
  }, [left, onFinish]);

  const finishLabel = mode === "test" ? t("exams.handIn") : t("exams.endPractice");
  // Unanswered questions are asked about first; counted when pressed — a typed answer is taken as
  // its field is left, a moment before.
  const askFinish = () => {
    const now = latestAnswers(eventsNow());
    const missing = items.filter((i) => !now.has(i.key)).length;
    if (mode === "test" && missing > 0) setConfirm(missing);
    else {
      handedIn.current = true;
      onFinish();
    }
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

  const send = (value: unknown) => {
    // Nothing more once the exam is being handed in (a draft taken as the page goes).
    if (handedIn.current || finishing) return;
    onAnswer(
      item.key,
      value,
      Date.now() - shownAt.current,
      mode === "practice" ? checkQuestion(item, value, lang) : undefined,
    );
  };
  const label = t("exams.question", { n: current + 1, total: items.length });
  // Said aloud and not yet answered in practice: the conversation (a mock exam keeps it as the answer
  // as it goes, practice once it is over).
  const conversation =
    conversing &&
    item.type === "respond" &&
    item.input === "speech" &&
    !(mode === "practice" && given) &&
    slots.conversation?.view({
      runId,
      itemKey: item.key,
      events,
      onStored: keep,
      onAnswer: (text, final) => (mode === "test" || final ? send({ text }) : undefined),
    });
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
      checkAtOnce={mode === "practice"}
      active
      run={runId}
      answer={given?.answer}
      // Practice shows each answer checked; a mock exam none until handed in.
      outcome={mode === "practice" ? given?.outcome : undefined}
      url={url}
      onAnswer={mode === "practice" && given ? undefined : send}
    />
  );
  // Practice rates an open answer once it is given (its criteria; the assistant's proposal later).
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
      <Button variant="outline" onClick={() => go(current - 1)} disabled={current === 0}>
        <ArrowLeft className="size-4" /> {t("exams.previous")}
      </Button>
      {last ? (
        <Button loading={finishing} onClick={askFinish}>
          {finishLabel}
        </Button>
      ) : (
        <Button variant={given ? "default" : "outline"} onClick={() => go(current + 1)}>
          {t("exams.next")} <ArrowRight className="size-4" />
        </Button>
      )}
    </>
  );

  const side = (picked?: () => void) => (
    <>
      <button
        type="button"
        onClick={onLeave}
        className="mr-8 mb-3 flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 lg:mr-0"
      >
        <ArrowLeft className="size-4 shrink-0" />{" "}
        <span className="truncate">{t("exams.leave")}</span>
      </button>
      <h2 className="mb-1 px-2 text-xl font-bold">
        {title}
        {module && ` · ${moduleTitle(module)}`}
      </h2>
      <p className="mb-3 px-2 text-sm text-muted-foreground">
        {mode === "test"
          ? t("exams.answered", { done: answered, total: items.length })
          : t("exams.practiceTally", { right, wrong, total: items.length })}
      </p>
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
                <Timer className="size-4" /> {clock(left)}
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
          handedIn.current = true;
          onFinish();
        }}
      />
    </>
  );
}
