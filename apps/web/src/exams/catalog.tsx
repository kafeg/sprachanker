// An exam's catalogue (09, Exams): every question open to the learner (the general ones and their
// state's) with its right answer marked, narrowed to those answered wrongly last time, not seen or
// known, or found by their words; shown in batches.
import { eligible, missingSettings } from "@sprachanker/engine";
import { parseEditionId } from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useEdition } from "@/api/edition.ts";
import { useExamPage, useExams } from "@/api/exams.ts";
import { useSettings } from "@/api/hooks.ts";
import { ItemCard } from "@/exercises/item-card.tsx";
import { Choice } from "@/ui/choice.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { BackLink, EmptyState, ErrorState, Loading, NotInstalled, Page } from "@/ui/page.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { type ExamParams, examKeyOf } from "./params.ts";
import { asExercise } from "./questions.ts";

const BATCH = 30;
type Filter = "all" | "wrong" | "unseen" | "known";

export function ExamCatalog({ params }: { params: ExamParams }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const key = examKeyOf(params);
  const exams = useExams();
  const row = exams.data?.find((e) => e.key === key);
  const edition = useEdition(params.series, params.course, row?.editions);
  const page = useExamPage(key, edition);
  const settings = useSettings();
  const [filter, setFilter] = useState<Filter>("all");
  const [words, setWords] = useState("");
  const [count, setCount] = useState(BATCH);

  const data = page.data;
  const setting = (k: string) => {
    const v = settings.data?.[k as keyof typeof settings.data];
    return typeof v === "string" ? v : undefined;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setting` reads settings.data
  const open = useMemo(
    () => (data ? eligible(data.exam, setting).flatMap(({ pool }) => pool) : []),
    [data, settings.data],
  );
  const exercise = useMemo(() => asExercise(key, open), [key, open]);

  if (exams.isPending || (row && (!edition || page.isPending))) return <Loading />;
  if (exams.isError) return <ErrorState error={exams.error} onRetry={() => exams.refetch()} />;
  if (!row) return <NotInstalled />;
  if (page.isError) return <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  if (!data) return <Loading />;

  const stat = (k: string) => data.stats[k]?.last;
  const needle = words.trim().toLocaleLowerCase();
  const shown = open.filter((i) => {
    if (filter === "wrong" && stat(i.key) !== "wrong") return false;
    if (filter === "unseen" && stat(i.key)) return false;
    if (filter === "known" && stat(i.key) !== "right") return false;
    if (!needle) return true;
    const text = [i.prompt, ...i.options.map((o) => o.text ?? "")].join(" ").toLocaleLowerCase();
    return text.includes(needle);
  });
  const title = data.locale?.title ?? key;
  return (
    <TargetLang value={edition ? parseEditionId(edition as never).target : "de"}>
      <Page
        title={t("exams.mode.catalog")}
        back={
          <BackLink onClick={() => void navigate({ to: "/exam/$series/$course/$exam", params })}>
            {title}
          </BackLink>
        }
      >
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Choice
            value={filter}
            options={(["all", "wrong", "unseen", "known"] as const).map((f) => [
              f,
              t(`exams.filter.${f}`),
            ])}
            onChange={(f) => {
              setFilter(f as Filter);
              setCount(BATCH);
            }}
          />
          <Input
            type="search"
            value={words}
            onChange={(e) => {
              setWords(e.target.value);
              setCount(BATCH);
            }}
            placeholder={t("exams.search")}
            aria-label={t("exams.search")}
            className="h-10 max-w-xs flex-1 bg-card"
          />
          <span className="text-sm text-muted-foreground">
            {t("exams.questions", { count: shown.length })}
          </span>
        </div>
        {missingSettings(data.exam, setting).length > 0 && (
          <p role="status" className="mb-4 rounded-xl bg-accent px-4 py-3 text-sm">
            {t("exams.needsStateCatalog")}
          </p>
        )}
        {shown.length ? (
          <ol className="space-y-6">
            {shown.slice(0, count).map((item) => {
              const index = open.indexOf(item);
              return (
                <li key={item.key}>
                  <p className="mb-1.5 text-sm text-muted-foreground">
                    {t("exams.number", { n: item.key.split("/q-")[1] ?? "" })}
                  </p>
                  <ItemCard
                    exercise={exercise}
                    locale={null}
                    index={index}
                    answer={{ optionId: item.answer.optionIds[0] }}
                    outcome={{ result: "correct", score: 1, ruleIds: [], lexemes: [] }}
                    url={(path) => mediaUrl(params.series, path)}
                  />
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState>{t("exams.noneMatch")}</EmptyState>
        )}
        {shown.length > count && (
          <Button
            variant="outline"
            className="mt-6 w-full"
            onClick={() => setCount((n) => n + BATCH)}
          >
            {t("exams.showMore", { count: Math.min(BATCH, shown.length - count) })}
          </Button>
        )}
      </Page>
    </TargetLang>
  );
}
