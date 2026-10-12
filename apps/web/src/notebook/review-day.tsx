// A review day in the Notebook, as a lesson's pass — a language's deck's alone when opened from
// its deck: its date (the study day's), what it held (answers, new cards, the share remembered, time
// spent) and every card answered that day in order — the word and its translation, the side asked,
// the rating, the interval it gave, how long it took — then the review days before and after it.
import type { CardFace } from "@sprachanker/schema";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type NotebookReviewDay, useNotebookReviewDay } from "@/api/notebook.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { LanguageFlag } from "@/ui/flags.tsx";
import { useDateFormat, useDuration, useNumber, usePercent, useSeconds } from "@/ui/format.ts";
import { BackLink, ErrorState, Loading, Page } from "@/ui/page.tsx";
import { Panel } from "@/ui/panel.tsx";
import { StatTile } from "@/ui/stat-tile.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useIntervalText } from "@/word/time.ts";
import { ratingOf } from "@/word/tones.ts";
import { GenderWord } from "@/word/word.tsx";

export function ReviewDay({
  id,
  lang,
  go,
}: {
  id: string;
  /** The deck's language: its answers alone, its days around. */
  lang?: string;
  go(run: string | null): void;
}) {
  const { t, i18n } = useTranslation();
  const day = useNotebookReviewDay(id, lang);
  const date = useDateFormat("day");
  const back = <BackLink onClick={() => go(null)}>{t("notebook.title")}</BackLink>;
  if (day.isPending) return <Loading />;
  if (day.isError)
    return (
      <Page back={back}>
        <ErrorState error={day.error} onRetry={() => day.refetch()} />
      </Page>
    );
  const { earlier, later } = day.data;
  return (
    <Page
      title={t("notebook.reviewDay", { date: date.format(day.data.date) })}
      back={back}
      actions={
        lang && (
          <span className="flex items-center gap-2 text-muted-foreground">
            <LanguageFlag lang={lang} />
            {languageName(lang, i18n.language, true)}
          </span>
        )
      }
    >
      <div className="max-w-3xl space-y-4">
        <Held day={day.data} />
        <Answers answers={day.data.answers} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" disabled={!earlier} onClick={() => earlier && go(earlier)}>
            <ArrowLeft className="rtl:-scale-x-100" />
            {t("notebook.earlierDay")}
          </Button>
          <Button variant="outline" disabled={!later} onClick={() => later && go(later)}>
            {t("notebook.laterDay")}
            <ArrowRight className="rtl:-scale-x-100" />
          </Button>
        </div>
      </div>
    </Page>
  );
}

/** What the day held, as the Notebook's tiles. */
function Held({ day }: { day: NotebookReviewDay }) {
  const { t } = useTranslation();
  const count = useNumber();
  const percent = usePercent();
  const duration = useDuration();
  const held = day.day;
  if (!held) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StatTile label={t("notebook.tile.review")} value={count(held.answers)} />
      <StatTile label={t("notebook.tile.newCards")} value={count(held.newCards)} />
      <StatTile
        label={t("notebook.tile.remembered")}
        value={held.remembered === null ? "—" : percent(held.remembered)}
        note={t("notebook.tile.rememberedHint")}
      />
      <StatTile label={t("notebook.tile.time")} value={held.ms ? duration(held.ms) : "—"} />
    </div>
  );
}

/** The day's answers in order: when, the word, the side, the rating, the interval, the time taken. */
function Answers({ answers }: { answers: NotebookReviewDay["answers"] }) {
  const { t } = useTranslation();
  const time = useDateFormat("time");
  const interval = useIntervalText();
  const seconds = useSeconds();
  if (!answers.length)
    return <p className="text-sm text-muted-foreground">{t("notebook.noAnswers")}</p>;
  return (
    <Panel title={t("notebook.dayAnswers")}>
      <ol className="divide-y">
        {answers.map((a) => {
          const rating = ratingOf(a.rating);
          return (
            <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
              <span className="w-12 shrink-0 text-sm text-muted-foreground tabular-nums">
                {time.format(a.ts)}
              </span>
              <span className="min-w-0 flex-1 basis-40">
                {a.card ? (
                  <TargetLang value={a.card.lang}>
                    <GenderWord text={a.card.display.target} gender={a.card.display.gender} />
                    {a.card.display.translation && (
                      <span className="ms-2 text-sm text-muted-foreground">
                        {a.card.display.translation}
                      </span>
                    )}
                  </TargetLang>
                ) : (
                  <span className="text-muted-foreground">{t("notebook.cardGone")}</span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {t(`myWords.face.${a.face as CardFace}`)}
                </span>
              </span>
              <span className="flex items-baseline gap-3 text-sm tabular-nums">
                <span className={cn("w-16 font-medium", rating.tone)}>
                  {t(`study.rating.${rating.key}`)}
                </span>
                <span className="w-14 text-end" title={t("notebook.intervalHint")}>
                  {interval(a.interval)}
                </span>
                <span
                  className="w-12 text-end text-muted-foreground"
                  title={t("notebook.tookHint")}
                >
                  {a.ms === null ? "—" : seconds(a.ms)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
