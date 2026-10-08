// A pass in full (09): every exercise as it was shown, with its first-try count; opened, each item with
// the answer it ended with (marked as checked), how many attempts it took, the explanations kept, and
// its history across passes. Then what else the pass did: texts checked, scenes, chats, words added.
import {
  answerAt,
  exerciseResults,
  exerciseState,
  firstAttempts,
  firstTry,
  shownExercises,
} from "@sprachanker/engine";
import { type LessonKey, parseEditionId, seriesOf } from "@sprachanker/schema";
import { History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { type NotebookPass, useNotebookPass } from "@/api/hooks.ts";
import { ItemCard } from "@/exercises/item-card.tsx";
import { ShuffleSeed } from "@/exercises/shared.tsx";
import { StepDot } from "@/lesson/plan.tsx";
import { Button } from "@/ui/components/button.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { ListRow, useSingleOpen } from "@/ui/history.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { RichText } from "@/ui/rich-text.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { GenderWord } from "@/word/word.tsx";
import { ItemHistory } from "./item-history.tsx";
import { usePassMark } from "./mark.ts";
import { SpokenCheckNote, spokenCheckOf } from "./spoken.tsx";

export function PassView({ id }: { id: string }) {
  const pass = useNotebookPass(id);
  if (pass.isPending) return <Loading />;
  if (pass.isError) return <ErrorState error={pass.error} onRetry={() => pass.refetch()} />;
  return (
    <TargetLang value={parseEditionId(pass.data.run.edition ?? "ru-de").target}>
      <Pass pass={pass.data} />
    </TargetLang>
  );
}

function Pass({ pass }: { pass: NotebookPass }) {
  const { t } = useTranslation();
  const when = useDateFormat("dayTime");
  const mark = usePassMark();
  const open = useSingleOpen<string>();
  const [history, setHistory] = useState<string>();
  const { run, events } = pass;
  const lessonKey = run.contextKey as LessonKey;
  const url = (path: string) => mediaUrl(seriesOf(lessonKey), path);
  const results = exerciseResults(events);
  const shown = shownExercises(events, pass.lesson, pass.locale);
  const total = pass.lesson && firstAttempts(pass.lesson, results);
  const attempts = (itemKey: string) =>
    events.filter((e) => e.type === "answered" && e.itemKey === itemKey).length;

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-muted-foreground">
        {when.format(run.startedAt)} · {mark(run)}
        {total?.scored
          ? ` · ${t("lesson.score", { correct: total.correct, scored: total.scored })}`
          : ""}
      </p>
      <Panel title={t("notebook.exercises")}>
        <ul className="divide-y">
          {shown.map(({ pageIndex, exercise, locale }) => {
            const r = results[exercise.key];
            const state = exerciseState(exercise, r);
            const first = firstTry(exercise, r);
            const key = exercise.key;
            return (
              <li key={key}>
                <ListRow expanded={open.isOpen(key)} onClick={() => open.toggle(key)}>
                  <StepDot state={state} label={pageIndex + 1} />
                  <span className="min-w-0 flex-1 truncate">
                    {locale?.title || t("lesson.exerciseN", { n: pageIndex + 1 })}
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {!state
                      ? t("lesson.notDone")
                      : first.scored
                        ? `${first.correct}/${first.scored}`
                        : t(`lesson.state.${state}`)}
                  </span>
                </ListRow>
                {open.isOpen(key) && (
                  // The options in the order this pass showed them.
                  <ShuffleSeed.Provider value={run.id}>
                    <ol className="space-y-4 pt-1 pb-4">
                      {exercise.items.map((item, index) => {
                        const last = r?.last[item.key];
                        const tries = attempts(item.key);
                        const explained = pass.explanations.filter((e) => e.itemKey === item.key);
                        return (
                          <li key={item.key} className="space-y-2">
                            <ItemCard
                              exercise={exercise}
                              locale={locale}
                              index={index}
                              answer={last?.answer}
                              outcome={last?.outcome}
                              url={url}
                            />
                            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                              <span>
                                {!tries
                                  ? r?.skipped.includes(item.key) ||
                                    r?.skippedFirst.includes(item.key)
                                    ? t("lesson.skipped")
                                    : t("lesson.notDone")
                                  : tries > 1 &&
                                      answerAt(events, item.key, 1)?.outcome?.result !==
                                        "correct" &&
                                      last?.outcome?.result === "correct"
                                    ? t("notebook.rightAt", { n: tries })
                                    : t("notebook.attempts", { count: tries })}
                              </span>
                              {tries > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setHistory(item.key)}
                                >
                                  <History /> {t("notebook.itemHistory")}
                                </Button>
                              )}
                            </div>
                            {explained.map((e) => (
                              <div key={e.ts} className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
                                <RichText text={e.text} />
                              </div>
                            ))}
                            <SpokenCheckNote
                              check={spokenCheckOf(pass.spoken, item.key, last?.answer)}
                            />
                          </li>
                        );
                      })}
                    </ol>
                  </ShuffleSeed.Provider>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
      <More pass={pass} />
      <ItemHistory
        itemKey={history}
        exercise={shown.find((s) => history?.startsWith(`${s.exercise.key}#`))}
        url={url}
        onClose={() => setHistory(undefined)}
      />
    </div>
  );
}

/** What else the pass did: texts checked, scenes, chats, words added. */
function More({ pass }: { pass: NotebookPass }) {
  const { t } = useTranslation();
  const { writing, scenes, chats, words } = pass;
  if (!writing.length && !scenes.length && !chats.length && !words.length) return null;
  return (
    <Panel title={t("notebook.more")} className="space-y-3">
      {writing.map((w) => (
        <p key={w.ts}>
          <span className="text-muted-foreground">{t(`writing.verdict.${w.verdict}`)}: </span>
          <span lang={parseEditionId(pass.run.edition ?? "ru-de").target}>{w.text}</span>
        </p>
      ))}
      {scenes.map((s) => (
        <p key={s.id}>
          {s.title}{" "}
          <span className="text-muted-foreground">
            · {t("scene.goals", { met: s.goalsMet, total: s.goals })}
          </span>
        </p>
      ))}
      {chats.map((c) => (
        <p key={c.id}>
          «{c.title}»{" "}
          <span className="text-muted-foreground">
            · {t("notebook.messages", { count: c.turns })}
          </span>
        </p>
      ))}
      {words.length > 0 && (
        <div>
          <p className="mb-1 text-sm text-muted-foreground">{t("notebook.wordsAdded")}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {words.map((w) => (
              <GenderWord
                key={w.target}
                text={w.target}
                gender={w.gender}
                className="font-normal"
              />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
