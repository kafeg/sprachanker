// A module's preparation before its Teile (owner, 2026-10-18: Goethe B1 Sprechen's 15 minutes, as the
// real exam has them): each Teil's task and cards with a field for notes, its time running down —
// in a mock exam the Teile begin by themselves when it is over, in practice it only says so — and
// "Begin" to go on before. The notes are kept in the run as they are written (a few seconds after
// the last key, and as a field is left); during the Teile each shows with its Teil (`TeilNotes`), as
// a candidate may look at their notes while speaking freely.
import type { ExamItem, ExamNotesPayload, LocaleExam } from "@sprachanker/schema";
import { NotebookPen, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui/components/button.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { inLang } from "@/ui/direction.tsx";
import { clock } from "@/ui/format.ts";
import { Panel } from "@/ui/panel.tsx";
import { useRequiredTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import type { ExamSection } from "./questions.ts";
import { TeilMaterial } from "./teil.tsx";

/** How long after the last key the notes are kept. */
const KEEP_AFTER_MS = 2000;

export function Preparation({
  module,
  title,
  teile,
  locale,
  notes: kept,
  left,
  minutes,
  url,
  onNotes,
  onBegin,
}: {
  module: string;
  /** The module's title. */
  title: string;
  /** The module's questions in the run, each with its Teil. */
  teile: Array<{ item: ExamItem; section?: ExamSection }>;
  locale: LocaleExam | null;
  /** The notes as kept. */
  notes: ExamNotesPayload["notes"];
  /** The time left (ms); none once it is over. */
  left?: number;
  minutes: number;
  url(path: string): string;
  onNotes(notes: ExamNotesPayload["notes"]): void;
  onBegin(notes: ExamNotesPayload["notes"]): void;
}) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  const [notes, setNotes] = useState(kept);
  const latest = useRef(notes);
  latest.current = notes;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Kept now, if anything changed since. */
  const keep = () => {
    clearTimeout(timer.current);
    const now = latest.current;
    if (JSON.stringify(now) !== JSON.stringify(kept)) onNotes(now);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: what is unsaved goes as the page does
  useEffect(() => () => keep(), []);
  const write = (key: string, text: string) => {
    setNotes((n) => ({ ...n, [key]: text }));
    clearTimeout(timer.current);
    timer.current = setTimeout(keep, KEEP_AFTER_MS);
  };
  return (
    <section aria-labelledby={`prepare-${module}`} className="space-y-6">
      <div className="space-y-2">
        <h2 id={`prepare-${module}`} className="font-heading text-xl font-bold">
          {t("exams.preparation.title", { module: title })}
        </h2>
        <p className="text-muted-foreground">{t("exams.preparation.text", { minutes })}</p>
        <p
          role="timer"
          className={cn(
            "flex items-center gap-1.5 font-heading text-lg font-bold tabular-nums",
            left === undefined && "text-destructive",
          )}
        >
          <Timer className="size-5" />
          {left === undefined
            ? t("exams.preparation.over")
            : t("exams.preparation.left", { time: clock(Math.ceil(left / 1000)) })}
        </p>
      </div>
      {teile.map(({ item, section }) => {
        const texts = section ? locale?.sections[section.key] : undefined;
        return (
          <Panel key={item.key} className="space-y-3 p-4">
            {texts?.title && <h3 className="font-heading text-lg font-bold">{texts.title}</h3>}
            {texts?.instructions && (
              <p {...inLang(lang)} className="whitespace-pre-line text-muted-foreground">
                {texts.instructions}
              </p>
            )}
            {section && <TeilMaterial section={section} locale={locale} url={url} />}
            <div className="space-y-1.5">
              <label
                htmlFor={`notes-${item.key}`}
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                <NotebookPen className="size-4" /> {t("exams.preparation.notes")}
              </label>
              <Textarea
                id={`notes-${item.key}`}
                {...inLang(lang)}
                value={notes[item.key] ?? ""}
                onChange={(e) => write(item.key, e.target.value.slice(0, 4000))}
                onBlur={keep}
                rows={4}
              />
            </div>
          </Panel>
        );
      })}
      <Button
        size="lg"
        onClick={() => {
          clearTimeout(timer.current);
          onBegin(latest.current);
        }}
      >
        {t("exams.preparation.begin")}
      </Button>
    </section>
  );
}

/** A Teil's notes from the preparation, to look at while speaking. */
export function TeilNotes({ text }: { text?: string }) {
  const { t } = useTranslation();
  const lang = useRequiredTargetLang();
  if (!text?.trim()) return null;
  return (
    <details open className="group mb-4 rounded-xl border bg-card px-4 py-2">
      <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium pointer-coarse:min-h-11">
        <NotebookPen className="size-4" /> {t("exams.preparation.yourNotes")}
      </summary>
      <p {...inLang(lang)} className="mt-2 whitespace-pre-line text-sm">
        {text}
      </p>
    </details>
  );
}
