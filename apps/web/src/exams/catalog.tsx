// An exam's catalogue (09, Exams; owner's choice F, 2026-10-10): every question open to the learner
// (the general ones and their state's) as a compact list by Teil, found by its words; a question
// opened shows its Teil's material and its right answer.
import { missingSettings, openQuestions, questionLine, settingOf } from "@sprachanker/engine";
import { examLang } from "@sprachanker/schema";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useSettings } from "@/api/hooks.ts";
import { type ExamParams, questionId } from "@/library/exam-address.ts";
import { BackLink, EmptyState, Page } from "@/ui/page.tsx";
import { panelClass } from "@/ui/panel.tsx";
import { SearchField } from "@/ui/search-field.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { exampleAnswer, inTeile } from "./questions.ts";
import { QuestionSources } from "./sources.tsx";
import { QuestionCard, TeilHeader } from "./teil.tsx";
import { useExam } from "./use-exam.tsx";

/** A question's number as the exam gives it: its id, without its module where the Teil names it. */
const numberOf = (key: string, modules: boolean) => {
  const id = questionId(key);
  return modules ? id.replace(/^[a-z]+-/, "") : id;
};

export function ExamCatalog({ params }: { params: ExamParams }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const exam = useExam(params);
  const { key } = exam;
  const settings = useSettings();
  const [words, setWords] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const setting = settingOf((k) => settings.data?.[k as keyof typeof settings.data]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setting` reads settings.data
  const open = useMemo(
    () => (exam.data ? openQuestions(exam.data.exam, setting) : []),
    [exam.data, settings.data],
  );

  if (!exam.ready) return exam.gate;
  const { edition, data } = exam;

  const needle = words.trim().toLocaleLowerCase();
  const shown = open.filter((i) => {
    if (!needle) return true;
    const options = i.type === "single_choice" ? i.options.map((o) => o.text ?? "") : [];
    const text = [i.prompt, i.text, ...options].join(" ").toLocaleLowerCase();
    return text.includes(needle);
  });
  const title = data.locale?.title ?? key;
  return (
    <TargetLang value={examLang(edition)}>
      <Page
        title={t("exams.mode.catalog")}
        back={
          <BackLink onClick={() => void navigate({ to: "/exam/$series/$course/$exam", params })}>
            {title}
          </BackLink>
        }
      >
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <SearchField
            value={words}
            onChange={(e) => setWords(e.target.value)}
            placeholder={t("exams.search")}
            aria-label={t("exams.search")}
            className="max-w-sm flex-1"
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
          <ol className={cn(panelClass, "divide-y")}>
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
                    <span lang={examLang(edition)} className="min-w-0 flex-1 truncate">
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
                          item.type === "respond" ? undefined : { result: "correct", score: 1 }
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
