// The Notebook's pictures: the span chosen (all time, 30 or 7 days) cut into bars by the server
// (engine `spanBars`, the study days' starts where the days are told apart) — the cards answered (new
// ones apart) and the share remembered in Review's section, the time spent beside the study days, the
// lessons done in the Lessons' — and a deck's words by state.
import { activityBars, type BarSize, countBars, type Span } from "@sprachanker/engine";
import { type Figure, MODULES } from "@sprachanker/schema";
import { useTranslation } from "react-i18next";
import type { NotebookOverview } from "@/api/notebook.ts";
import { BarChart, ChartLegend, ShareBar } from "@/ui/bar-chart.tsx";
import { useDateFormat, useDuration, useNumber, usePercent } from "@/ui/format.ts";

/** The span's bars with each one's totals, and how a bar is named: its Gregorian day, with the year
 *  when the span crosses one, or its month. */
export function useSpan(overview: NotebookOverview, span: Span) {
  const { t } = useTranslation();
  const day = useDateFormat("barDay");
  const dayYear = useDateFormat("barDayYear");
  const month = useDateFormat("monthYear");
  const { size, starts } = overview.spans[span];
  const years = new Set(starts.map((s) => new Date(s).getFullYear()));
  const date = (start: number) =>
    (size === "month" ? month : years.size > 1 ? dayYear : day).format(start);
  return {
    size,
    starts,
    bars: activityBars(overview.days, starts),
    /** A bar in words: its day, the week from its first day, its month. */
    when: (start: number) =>
      size === "week" ? t("notebook.chart.weekOf", { date: date(start) }) : date(start),
    ends: [date(starts[0] as number), date(starts.at(-1) as number)] as [string, string],
  };
}
export type SpanBars = ReturnType<typeof useSpan>;

/** A picture's heading: what it shows and what a bar stands for. */
function Heading({ title, size }: { title: string; size: BarSize }) {
  const { t } = useTranslation();
  return (
    <h4 className="font-sans font-medium text-muted-foreground">
      {title} <span className="text-xs font-normal">· {t(`notebook.chart.by.${size}`)}</span>
    </h4>
  );
}

/** Cards answered in each bar, the new ones apart. */
export function CardsPicture({ span }: { span: SpanBars }) {
  const { t } = useTranslation();
  const count = useNumber();
  const top = Math.max(0, ...span.bars.map((b) => b.review));
  const label = t("notebook.tile.review");
  return (
    <div className="space-y-1.5">
      <Heading title={label} size={span.size} />
      <BarChart
        label={label}
        top={count(top)}
        ends={span.ends}
        tones={["bg-srs-new", "bg-correct"]}
        bars={span.bars.map((b) => ({
          key: b.start,
          parts: [b.newCards, b.review - b.newCards],
          title: t("notebook.chart.cardsTitle", {
            when: span.when(b.start),
            count: b.review,
            fresh: b.newCards,
          }),
        }))}
      />
      <ChartLegend
        items={[
          { label: t("notebook.tile.newCards"), tone: "bg-srs-new" },
          { label: t("notebook.chart.seen"), tone: "bg-correct" },
        ]}
      />
    </div>
  );
}

/** The share of the answers to cards in review not "Again", in each bar that has any. */
export function RememberedPicture({ span }: { span: SpanBars }) {
  const { t } = useTranslation();
  const percent = usePercent();
  const label = t("notebook.chart.remembered");
  return (
    <div className="space-y-1.5">
      <Heading title={label} size={span.size} />
      <BarChart
        label={label}
        max={1}
        top={percent(1)}
        ends={span.ends}
        tones={["bg-correct"]}
        bars={span.bars.map((b) => ({
          key: b.start,
          parts: [b.remembered ?? 0],
          // None remembered is a mark; no card in review answered, nothing.
          zero: b.remembered === 0,
          title:
            b.remembered === undefined
              ? t("notebook.chart.noneRecalled", { when: span.when(b.start) })
              : t("notebook.chart.rememberedTitle", {
                  when: span.when(b.start),
                  share: percent(b.remembered),
                  count: b.recalled,
                }),
        }))}
      />
    </div>
  );
}

/** Time spent in each bar, each module's in its title. */
export function TimePicture({ span }: { span: SpanBars }) {
  const { t } = useTranslation();
  const duration = useDuration();
  const top = Math.max(0, ...span.bars.map((b) => b.timeAll));
  const label = t("notebook.tile.time");
  return (
    <div className="space-y-1.5">
      <Heading title={label} size={span.size} />
      <BarChart
        label={label}
        top={top ? duration(top) : ""}
        ends={span.ends}
        tones={["bg-primary"]}
        bars={span.bars.map((b) => ({
          key: b.start,
          parts: [b.timeAll],
          title: b.timeAll
            ? t("notebook.chart.timeTitle", {
                when: span.when(b.start),
                time: duration(b.timeAll),
                what: MODULES.filter((m) => b.time[m] > 0)
                  .map((m) => t(`notebook.chart.timeOf.${m}`, { time: duration(b.time[m]) }))
                  .join(", "),
              })
            : t("notebook.dayTitle", { date: span.when(b.start), what: t("notebook.nothing") }),
        }))}
      />
    </div>
  );
}

/** Lessons done by the end of each bar (a lesson counted when first done), and those done in it. */
export function DonePicture({ span, done }: { span: SpanBars; done: Figure }) {
  const { t } = useTranslation();
  const count = useNumber();
  const bars = countBars(done.at ?? [], span.starts);
  const label = t("notebook.figure.lesson.lessonsDone");
  return (
    <div className="space-y-1.5">
      <Heading title={label} size={span.size} />
      <BarChart
        label={label}
        top={count(bars.at(-1)?.total ?? 0)}
        ends={span.ends}
        tones={["bg-primary"]}
        bars={bars.map((b) => ({
          key: b.start,
          parts: [b.total],
          title: t("notebook.chart.doneTitle", {
            when: span.when(b.start),
            count: b.within,
            total: b.total,
          }),
        }))}
      />
    </div>
  );
}

/** A deck's words by state as one bar across: new, learning, in review, learnt, suspended. */
const STATES = [
  // The counts' hues (word/tones.ts): new violet, learning as Again, in review as Good.
  ["new", "bg-srs-new"],
  ["learning", "bg-wrong"],
  ["review", "bg-correct/50"],
  ["mature", "bg-correct"],
  ["suspended", "bg-muted-foreground/40"],
] as const;

export function WordsPicture({ figures }: { figures: Figure[] }) {
  const { t } = useTranslation();
  const count = useNumber();
  const parts = STATES.map(([id, tone]) => {
    const value = figures.find((f) => f.id === id)?.value ?? 0;
    const label = t(`notebook.figure.review.${id}`);
    return { value, tone, label, title: t("notebook.chart.part", { label, n: value }) };
  });
  return (
    <div className="mt-2 space-y-1.5">
      <ShareBar
        label={t("notebook.chart.words", {
          parts: parts.map((p) => `${p.label} ${count(p.value)}`).join(", "),
        })}
        parts={parts}
      />
      <ChartLegend items={parts.map((p) => ({ label: p.label, tone: p.tone }))} />
    </div>
  );
}
