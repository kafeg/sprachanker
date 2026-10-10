// An exam's catalogue (09, Exams; owner's choice F, 2026-10-10): every question open to the learner
// (the general ones and their state's) as a compact list by Teil, found by its words; a question
// opened shows its Teil's material and its right answer.
import { eligible, missingSettings } from "@sprachanker/engine";
import { parseEditionId } from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useEdition } from "@/api/edition.ts";
import { useExamPage, useExams } from "@/api/exams.ts";
import { useSettings } from "@/api/hooks.ts";
import { Input } from "@/ui/components/input.tsx";
import { BackLink, EmptyState, ErrorState, Loading, NotInstalled, Page } from "@/ui/page.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { type ExamParams, examKeyOf } from "./params.ts";
import { exampleAnswer, inTeile, questionLine } from "./questions.ts";
import { QuestionSources } from "./sources.tsx";
import { QuestionCard, TeilHeader } from "./teil.tsx";

/** A question's number as the exam gives it: its id, without its module where the Teil names it. */
const numberOf = (key: string, modules: boolean) => {
  const id = key.split("/q-")[1] ?? "";
  return modules ? id.replace(/^[a-z]+-/, "") : id;
};

export function ExamCatalog({ params }: { params: ExamParams }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const key = examKeyOf(params);
  const exams = useExams();
  const row = exams.data?.find((e) => e.key === key);
  const edition = useEdition(params.series, params.course, row?.editions);
  const page = useExamPage(key, edition);
  const settings = useSettings();
  const [words, setWords] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());

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

  if (exams.isPending || (row && (!edition || page.isPending))) return <Loading />;
  if (exams.isError) return <ErrorState error={exams.error} onRetry={() => exams.refetch()} />;
  if (!row) return <NotInstalled />;
  if (page.isError) return <ErrorState error={page.error} onRetry={() => page.refetch()} />;
  if (!data) return <Loading />;

  const needle = words.trim().toLocaleLowerCase();
  const shown = open.filter((i) => {
    if (!needle) return true;
    const options = i.type === "single_choice" ? i.options.map((o) => o.text ?? "") : [];
    const text = [i.prompt, i.text, ...options].join(" ").toLocaleLowerCase();
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
          <Input
            type="search"
            value={words}
            onChange={(e) => setWords(e.target.value)}
            placeholder={t("exams.search")}
            aria-label={t("exams.search")}
            className="h-10 max-w-sm flex-1 bg-card"
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
          <ol className="divide-y rounded-2xl border bg-card">
            {inTeile(data.exam, shown, {}).map(({ item, section, opens }) => {
              const isOpen = opened.has(item.key);
              const texts = section && data.locale?.sections[section.key];
              const module =
                section?.module &&
                (data.locale?.modules?.[section.module]?.title ?? section.module);
              return (
                <li key={item.key}>
                  {/* A Teil's name where its questions begin (an exam of several). */}
                  {opens && data.exam.sections.length > 1 && texts?.title && (
                    <p className="bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                      {[module, texts.title].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpened((s) => {
                        const next = new Set(s);
                        if (!next.delete(item.key)) next.add(item.key);
                        return next;
                      })
                    }
                    className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent pointer-coarse:min-h-14"
                  >
                    <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">
                      {numberOf(item.key, !!data.exam.modules)}
                    </span>
                    <span
                      lang={edition ? parseEditionId(edition as never).target : "de"}
                      className="min-w-0 flex-1 truncate"
                    >
                      {questionLine(item)}
                    </span>
                    <ChevronDown
                      className={`size-4 shrink-0 transition ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-4 pt-1 pb-4">
                      {section && (
                        <TeilHeader
                          section={section}
                          locale={data.locale}
                          examples={(section.examples ?? []).flatMap(
                            (k) => data.exam.items.find((i) => i.key === k) ?? [],
                          )}
                          examplesOpen={false}
                          limited={false}
                          run=""
                          url={(path) => mediaUrl(params.series, path)}
                        />
                      )}
                      <QuestionCard
                        item={item}
                        label=""
                        run=""
                        answer={exampleAnswer(item)}
                        outcome={
                          item.type === "respond"
                            ? undefined
                            : { result: "correct", score: 1, ruleIds: [], lexemes: [] }
                        }
                        url={(path) => mediaUrl(params.series, path)}
                      />
                      {data.sources && (
                        <QuestionSources sources={data.sources} itemKey={item.key} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState>{t("exams.noneMatch")}</EmptyState>
        )}
      </Page>
    </TargetLang>
  );
}
