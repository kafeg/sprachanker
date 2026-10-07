// A lesson in the Notebook (09): its passes, newest first — when, how long, the score, what was done —
// each opening in full; two chosen are compared side by side.
import { type LessonKey, parseLessonKey } from "@sprachanker/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type NotebookPassSummary, useNotebookLesson } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { ListRow } from "@/ui/history.tsx";
import { BackLink, EmptyState, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { CompareView } from "./compare.tsx";
import { usePassMark } from "./mark.ts";
import { PassView } from "./pass.tsx";

export type LessonView = { pass?: string; compare?: string };

/** What a pass did besides the exercises, in words. */
function useDone() {
  const { t } = useTranslation();
  return (p: NotebookPassSummary) =>
    [
      p.total !== null
        ? t("notebook.worked", { worked: p.worked, total: p.total })
        : t("notebook.workedSome", { count: p.worked }),
      p.explanations > 0 && t("notebook.explanations", { count: p.explanations }),
      p.writing > 0 && t("notebook.writing", { count: p.writing }),
      p.scenes > 0 && t("notebook.scenes", { count: p.scenes }),
      p.chats > 0 && t("notebook.chats", { count: p.chats }),
      p.words > 0 && t("notebook.words", { count: p.words }),
    ]
      .filter(Boolean)
      .join(" · ");
}

export function LessonNotebook({
  lessonKey,
  view,
  go,
}: {
  lessonKey: LessonKey;
  view: LessonView;
  go(view: LessonView | null): void;
}) {
  const { t } = useTranslation();
  const lesson = useNotebookLesson(lessonKey);
  const when = useDateFormat("dayTime");
  const done = useDone();
  const mark = usePassMark();
  const [chosen, setChosen] = useState<string[]>([]);
  const { unit, lesson: n } = parseLessonKey(lessonKey);
  if (lesson.isPending) return <Loading />;
  if (lesson.isError) return <ErrorState error={lesson.error} onRetry={() => lesson.refetch()} />;
  const title = `${unit}.${n} ${lesson.data.title ?? ""}`.trim();
  const passes = lesson.data.passes;

  if (view.pass)
    return (
      <Page title={title}>
        <BackLink onClick={() => go({})}>{t("notebook.passes")}</BackLink>
        <PassView id={view.pass} />
      </Page>
    );
  const pair = view.compare?.split(",");
  if (pair?.length === 2)
    return (
      <Page title={title}>
        <BackLink onClick={() => go({})}>{t("notebook.passes")}</BackLink>
        <CompareView ids={[pair[0] as string, pair[1] as string]} />
      </Page>
    );

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));
  return (
    <Page title={title}>
      <BackLink onClick={() => go(null)}>{t("notebook.title")}</BackLink>
      <div className="max-w-3xl space-y-3">
        {passes.length ? (
          <Panel title={t("notebook.passes")}>
            <ul className="divide-y">
              {passes.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  {passes.length > 1 && (
                    <input
                      type="checkbox"
                      aria-label={t("notebook.choose", { date: when.format(p.startedAt) })}
                      checked={chosen.includes(p.id)}
                      onChange={() => toggle(p.id)}
                      className="size-5 shrink-0 accent-primary pointer-coarse:size-6"
                    />
                  )}
                  <ListRow onClick={() => go({ pass: p.id })}>
                    <span className="min-w-0 flex-1">
                      <span className="block">
                        {when.format(p.startedAt)} ·{" "}
                        {t("notebook.minutes", {
                          count: Math.max(1, Math.round((p.endedAt - p.startedAt) / 60_000)),
                        })}
                      </span>
                      <span className="block text-sm text-muted-foreground">{done(p)}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{mark(p)}</span>
                  </ListRow>
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <EmptyState>{t("notebook.noPasses")}</EmptyState>
        )}
        {passes.length > 1 && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={chosen.length !== 2}
              onClick={() => {
                // Older first, as they happened.
                const [a, b] = [...chosen].sort(
                  (x, y) =>
                    (passes.find((p) => p.id === x)?.startedAt ?? 0) -
                    (passes.find((p) => p.id === y)?.startedAt ?? 0),
                );
                go({ compare: `${a},${b}` });
              }}
            >
              {t("notebook.compare")}
            </Button>
            <span className="text-sm text-muted-foreground">{t("notebook.compareHint")}</span>
          </div>
        )}
      </div>
    </Page>
  );
}
