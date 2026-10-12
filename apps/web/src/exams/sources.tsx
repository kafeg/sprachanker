// Where an exam was read and what was checked (owner, 2026-10-10: proof that the data is the
// source's): the documents with their addresses and the copies kept (sha256, when read), the checks
// the import ran with how many questions passed, what a mock exam here shows and what it does not; and
// a question's own places in the documents.
import type { ExamSources } from "@sprachanker/schema";
import { Check, ExternalLink, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDateFormat } from "@/ui/format.ts";
import { panelClass } from "@/ui/panel.tsx";
import { cn } from "@/ui/utils.ts";

export function ExamSourcesPanel({ sources }: { sources: ExamSources }) {
  const { t } = useTranslation();
  const date = useDateFormat("day");
  const passed = sources.checks.every((c) => c.passed === c.of);
  return (
    <details className={cn(panelClass, "group mt-4")}>
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 py-2 pointer-coarse:min-h-14">
        <ShieldCheck className={passed ? "size-5 text-correct" : "size-5 text-wrong"} aria-hidden />
        <span className="flex-1 font-medium">{t("exams.sources.title")}</span>
        <span className="text-sm text-muted-foreground">
          {passed ? t("exams.sources.allPassed") : t("exams.sources.someFailed")}
        </span>
      </summary>
      <div className="space-y-4 border-t px-4 py-4 text-sm">
        <p className="text-muted-foreground">{t("exams.sources.statement")}</p>
        <div>
          <h3 className="mb-2 font-medium">{t("exams.sources.documents")}</h3>
          <ul className="space-y-2">
            {sources.documents.map((d) => (
              <li key={d.id}>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-4 hover:underline pointer-coarse:min-h-11"
                >
                  {d.title} <ExternalLink className="size-3 shrink-0" />
                </a>
                <p className="text-xs break-all text-muted-foreground">
                  {d.sha256
                    ? t("exams.sources.copy", {
                        hash: d.sha256.slice(0, 16),
                        date: date.format(sources.read),
                      })
                    : t("exams.sources.read", { date: date.format(sources.read) })}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 font-medium">{t("exams.sources.checks")}</h3>
          <ul className="space-y-1.5">
            {sources.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.passed === c.of ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-correct" aria-hidden />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-wrong" aria-hidden />
                )}
                <span className="flex-1">{t(`exams.check.${c.id}`)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t("exams.points", { points: c.passed, max: c.of })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

/** Where a question and its answer were found: the document (a link) and the place in it. */
export function QuestionSources({ sources, itemKey }: { sources: ExamSources; itemKey: string }) {
  const { t } = useTranslation();
  const places = sources.items[itemKey as keyof typeof sources.items] ?? [];
  if (!places.length) return null;
  return (
    <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">
      {places.map((p) => {
        const doc = sources.documents.find((d) => d.id === p.document);
        return (
          <li key={`${p.document}|${p.at}`}>
            {t("exams.sources.from")}{" "}
            {doc ? (
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center underline underline-offset-2 pointer-coarse:min-h-11"
              >
                {doc.title}
              </a>
            ) : (
              p.document
            )}
            , {p.at}
          </li>
        );
      })}
    </ul>
  );
}
