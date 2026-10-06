// Review (09): the faces due now and the day's new ones, one card at a time — the front, a tap (or Space)
// for the back, then "Forgot" or "Remembered" (keys 1, 2) with when it comes back. Two ratings are
// enough for FSRS (again, good).
import type { CardDisplay, CardFace } from "@sprachanker/schema";
import { parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useRateCard, useReviewQueue } from "@/api/hooks.ts";
import { ErrorState, Loading, Page } from "@/ui/app-shell.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Progress } from "@/ui/components/progress.tsx";
import { AudioButton } from "@/ui/media.tsx";
import { GenderWord } from "@/word/word.tsx";

/** "in 10 minutes", "tomorrow", "in 4 days": when a face comes back. */
function useWhen() {
  const { i18n } = useTranslation();
  const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  return (due: number, now: number) => {
    const minutes = Math.max(1, Math.round((due - now) / 60_000));
    if (minutes < 60) return format.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (hours < 24) return format.format(hours, "hour");
    return format.format(Math.round(hours / 24), "day");
  };
}

function Side({ display, part }: { display: CardDisplay; part: "word" | "meaning" }) {
  if (part === "meaning") return <span className="text-2xl">{display.translation}</span>;
  return (
    <span className="grid justify-items-center gap-1">
      <GenderWord text={display.target} gender={display.gender} className="text-3xl" />
      {/* Sources often give the plural in the headword already ("die Frau, die Frauen"). */}
      {display.plural && !display.target.includes(display.plural) && (
        <span className="text-muted-foreground">{display.plural}</span>
      )}
    </span>
  );
}

/** What a face shows first and what the answer adds. */
const FRONT: Record<CardFace, Array<"word" | "meaning" | "audio">> = {
  recognition: ["word", "audio"],
  production: ["meaning"],
  listening: ["audio"],
};

export function ReviewPage() {
  const { t } = useTranslation();
  const queue = useReviewQueue();
  const rate = useRateCard();
  const when = useWhen();
  const [shown, setShown] = useState(false);
  const [rated, setRated] = useState(0);
  const item = queue.data?.items[0];

  const answer = (rating: 1 | 3) => {
    if (!item || rate.isPending) return;
    rate.mutate(
      { cardId: item.cardId, face: item.face, rating },
      {
        onSuccess: () => {
          setRated((n) => n + 1);
          setShown(false);
        },
      },
    );
  };

  // Space shows the answer; 1 and 2 rate it (desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [role=dialog]")) return;
      if (!shown && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setShown(true);
      } else if (shown && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        answer(e.key === "1" ? 1 : 3);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (queue.isPending) return <Loading />;
  if (queue.isError) return <ErrorState error={queue.error} onRetry={() => queue.refetch()} />;
  const { items, newToday, newPerDay } = queue.data;
  const total = rated + items.length;

  if (!item)
    return (
      <Page title={t("nav.review")}>
        <div className="max-w-xl space-y-3 rounded-2xl border bg-card px-6 py-8">
          <h2 className="text-2xl font-bold">
            {rated ? t("cardReview.allDone", { count: rated }) : t("cardReview.nothingDue")}
          </h2>
          <p className="text-muted-foreground">{t("cardReview.comeBack")}</p>
        </div>
      </Page>
    );

  const { display } = item;
  const now = Date.now();
  const front = FRONT[item.face];
  const audio = display.audio && mediaUrl(display.series, display.audio);
  const lesson = parseLessonKey(display.lessonKey);

  return (
    <Page title={t("nav.review")}>
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="tabular-nums">{t("cardReview.progress", { n: rated + 1, total })}</span>
          <span className="tabular-nums">
            {t("cardReview.newToday", { n: newToday, limit: newPerDay })}
          </span>
        </div>
        <Progress value={(rated / total) * 100} className="h-1.5" />
        <button
          type="button"
          key={`${item.cardId}-${item.face}-${rated}`}
          onClick={() => setShown(true)}
          aria-expanded={shown}
          className="grid min-h-56 w-full place-items-center rounded-3xl border bg-card px-6 py-6 text-center sm:min-h-80 sm:py-8"
        >
          <span className="grid justify-items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {t(`cardReview.face.${item.face}`)}
            </span>
            {front.includes("word") && <Side display={display} part="word" />}
            {front.includes("meaning") && <Side display={display} part="meaning" />}
            {front.includes("audio") && audio && (
              <AudioButton src={audio} label={display.target} className="size-12" />
            )}
            {shown ? (
              <span className="grid justify-items-center gap-2 border-t pt-3">
                {!front.includes("word") && <Side display={display} part="word" />}
                {!front.includes("meaning") && <Side display={display} part="meaning" />}
                {!front.includes("audio") && audio && (
                  <AudioButton src={audio} label={display.target} className="size-11" />
                )}
                {display.example && (
                  <span className="text-sm italic text-muted-foreground">{display.example}</span>
                )}
                <Link
                  to="/lesson/$series/$course/$lesson"
                  params={{
                    series: display.series,
                    course: lesson.courseId,
                    lesson: lesson.name,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm text-muted-foreground underline"
                >
                  {t("cardReview.fromLesson", { unit: lesson.unit, lesson: lesson.lesson })}
                </Link>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{t("cardReview.tapToShow")}</span>
            )}
          </span>
        </button>
        {shown ? (
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="lg"
              className="h-auto flex-col gap-0.5 py-3 text-base"
              disabled={rate.isPending}
              onClick={() => answer(1)}
            >
              <span className="text-wrong">{t("cardReview.forgot")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {when(item.due[1], now)}
              </span>
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-auto flex-col gap-0.5 py-3 text-base"
              disabled={rate.isPending}
              onClick={() => answer(3)}
            >
              <span className="text-correct">{t("cardReview.remembered")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {when(item.due[3], now)}
              </span>
            </Button>
          </div>
        ) : (
          <Button size="lg" className="w-full text-base" onClick={() => setShown(true)}>
            {t("cardReview.show")}
          </Button>
        )}
      </div>
    </Page>
  );
}
