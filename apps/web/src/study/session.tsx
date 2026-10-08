// Studying cards as in Anki's reviewer (09) — Review's decks and a lesson's words use the same session:
// the card, the counts (new + learning + review, the current queue underlined), "Show answer", then
// Again / Hard / Good / Easy with when each brings the card back; Undo on the left, More on the right
// (more-menu.tsx). Keys as in Anki (reviewer-keys.ts); one action at a time. On a phone a tap on the
// card shows the answer and the buttons are coloured, the interval inside (AnkiDroid).
import { SRS_DEFAULTS } from "@sprachanker/engine";
import type { CardRating } from "@sprachanker/schema";
import { Flag, Star, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCardActions, useStudy } from "@/api/hooks.ts";
import { Button } from "@/ui/components/button.tsx";
import type { AudioControls } from "@/ui/media.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { type Side, StudyCard } from "./card.tsx";
import { FLAG_CLASS, FLAGS, MoreMenu } from "./more-menu.tsx";
import { type ReviewerAction, useReviewerKeys } from "./reviewer-keys.ts";
import { useIntervalText } from "./time.ts";
import { COUNT_TONE, RATINGS } from "./tones.ts";

type Study = NonNullable<ReturnType<typeof useStudy>["data"]>;

/** Show answer and the four ratings: one height, so the bar keeps its size when the answer opens. */
const BAR_BUTTON = "h-14 min-h-14";

/**
 * Anki's three counts (new, learning, to review) in their colours, each named, the queue of the card on
 * screen underlined; and about how many answers finish the session. Under the buttons on both sides, so
 * nothing moves when the answer opens.
 */
export function Counts({
  study,
  current,
}: {
  study: Pick<Study, "counts" | "answersLeft">;
  current?: "new" | "learning" | "review";
}) {
  const { t } = useTranslation();
  const { counts, answersLeft } = study;
  const cell = (value: React.ReactNode, label: string, tone?: string, underline?: boolean) => (
    <span className="grid justify-items-center leading-tight">
      <span
        className={cn(
          "text-lg font-medium tabular-nums",
          tone,
          underline && "underline underline-offset-4",
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
  return (
    <div className="flex justify-center gap-5" title={t("study.countsTitle", counts)}>
      <span className="sr-only">{t("study.countsTitle", counts)}</span>
      <div aria-hidden className="contents">
        {(["new", "learning", "review"] as const).map((kind) => (
          <span key={kind}>
            {cell(counts[kind], t(`study.count.${kind}`), COUNT_TONE[kind], current === kind)}
          </span>
        ))}
      </div>
      <span title={t("study.leftTitle")}>
        {cell(t("study.leftValue", { n: answersLeft }), t("study.left", { n: answersLeft }))}
      </span>
    </div>
  );
}

/** Anki's congratulations: finished for now, and why (learning later, limits, buried cards). */
function Finished({ study, onUnbury }: { study: Study; onUnbury(): void }) {
  const { t } = useTranslation();
  const minutes =
    study.nextLearning !== null
      ? Math.max(1, Math.ceil((study.nextLearning - study.now) / 60_000))
      : null;
  return (
    <div className="space-y-3 rounded-3xl border bg-card px-6 py-8 text-center">
      <h2 className="text-2xl font-bold">{t("study.finished")}</h2>
      {minutes !== null && <p>{t("study.nextLearning", { minutes })}</p>}
      {study.reviewsWaiting && <p className="text-muted-foreground">{t("study.reviewLimit")}</p>}
      {study.newWaiting && <p className="text-muted-foreground">{t("study.newLimit")}</p>}
      {study.buried > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground">{t("study.buried")}</p>
          <Button variant="outline" onClick={onUnbury}>
            {t("study.unbury")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function StudySession({
  scope,
  finished,
  stickyBar = true,
}: {
  /** "all", "lang:de", "course:…" or "lesson:…" (a lesson's own words). */
  scope: string;
  /** What shows instead of Anki's congratulations once nothing is left (a lesson's words step). */
  finished?(study: Study): React.ReactNode;
  /** The buttons' bar sticks to the bottom of the screen (not where another bar does). */
  stickyBar?: boolean;
}) {
  const { t } = useTranslation();
  const study = useStudy(scope);
  const actions = useCardActions();
  const intervalOf = useIntervalText();
  // Counts ratings and undos, so a card back on screen (a learning step, an undo) opens anew.
  const [turn, setTurn] = useState(0);
  const sound = useRef<AudioControls>(null);
  const current = study.data?.current;
  const cardKey = current ? `${current.cardId}:${current.face}:${turn}` : "";
  // The answer is shown for one card only, so the next card opens on its question in the same render.
  const [shownFor, setShownFor] = useState<string>();
  const side: Side = cardKey && shownFor === cardKey ? "answer" : "question";
  const showAnswer = () => setShownFor(cardKey);

  // One action at a time: a second press before the first is stored would act on the old state
  // (Ctrl+1 twice would set the flag twice instead of taking it off).
  const busy = study.isFetching || Object.values(actions).some((a) => a.isPending);
  const rate = (rating: CardRating) => {
    if (!current || busy || side !== "answer") return;
    actions.rate.mutate(
      { cardId: current.cardId, face: current.face, rating, reps: current.reps },
      { onSuccess: () => setTurn((n) => n + 1) },
    );
  };
  const undo = () =>
    !busy &&
    study.data?.canUndo &&
    actions.undo.mutate(undefined, { onSuccess: () => setTurn((n) => n + 1) });
  const bury = (note: boolean) =>
    current &&
    !busy &&
    actions.bury.mutate({ cardId: current.cardId, face: note ? undefined : current.face });
  const suspend = (note: boolean) =>
    current &&
    !busy &&
    actions.suspend.mutate({ cardId: current.cardId, face: note ? undefined : current.face });
  const flag = (n: number) =>
    current &&
    !busy &&
    actions.flag.mutate({
      cardId: current.cardId,
      face: current.face,
      flag: current.flag === n ? 0 : n,
    });
  const mark = () =>
    current && !busy && actions.mark.mutate({ cardId: current.cardId, marked: !current.marked });

  /** What a key or the More menu does with the card on screen. */
  const act = (action: ReviewerAction) => {
    if (action.do === "show") showAnswer();
    else if (action.do === "rate") rate(action.rating);
    else if (action.do === "replay") sound.current?.play();
    else if (action.do === "undo") undo();
    else if (action.do === "bury") bury(action.note);
    else if (action.do === "suspend") suspend(action.note);
    else if (action.do === "mark") mark();
    else flag(action.flag);
  };
  useReviewerKeys(side, !!current, act);

  // Finished for now: the deck opens again when its next learning card comes within the learn-ahead.
  const wakeAt = !current && study.data?.nextLearning;
  useEffect(() => {
    if (!wakeAt || !study.data) return;
    const wait = wakeAt - SRS_DEFAULTS.learnAheadMs - study.data.now;
    const timer = setTimeout(() => study.refetch(), Math.max(1000, wait));
    return () => clearTimeout(timer);
  }, [wakeAt, study.data, study.refetch]);

  if (study.isPending) return <Loading />;
  if (study.isError) return <ErrorState error={study.error} onRetry={() => study.refetch()} />;
  const data = study.data;
  if (!current)
    return finished ? (
      finished(data)
    ) : (
      <Finished study={data} onUnbury={() => actions.unbury.mutate(scope)} />
    );

  const marks = (
    <>
      {current.flag > 0 && (
        <Flag
          className={cn("size-4 fill-current", FLAG_CLASS[current.flag - 1])}
          aria-label={t(`study.flag.${FLAGS[current.flag - 1]}`)}
        />
      )}
      {current.marked && (
        <Star className="size-4 fill-current text-amber-500" aria-label={t("study.marked")} />
      )}
      {current.leech && (
        <span className="rounded-full bg-wrong-soft px-2 text-xs text-wrong">
          {t("study.leech")}
        </span>
      )}
    </>
  );

  return (
    // Phone: the card fills the screen and the buttons sit at its bottom, under the thumb (AnkiDroid).
    <div className="flex flex-col gap-3 max-sm:flex-1">
      {/* The word's language: the example's and which way card 2 asks. */}
      <TargetLang value={current.lang}>
        <StudyCard
          key={cardKey}
          cardId={current.cardId}
          display={current.display}
          face={current.face}
          side={side}
          onTap={showAnswer}
          audio={sound}
          marks={current.flag || current.marked || current.leech ? marks : undefined}
        />
      </TargetLang>
      <div
        className={cn(
          "-mx-4 grid grid-cols-[auto_1fr_auto] items-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-b-2xl",
          stickyBar && "sticky bottom-0 z-10 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("study.undo")}
          title={t("study.undoKeys")}
          disabled={!data.canUndo || actions.undo.isPending}
          onClick={undo}
        >
          <Undo2 className="size-5" />
        </Button>
        <div className="grid justify-items-center gap-2">
          {/* The same height on both sides: the answer opening moves nothing. */}
          {side === "question" ? (
            <Button
              size="lg"
              className={cn("w-full max-w-lg text-base", BAR_BUTTON)}
              title={t("study.showKeys")}
              onClick={showAnswer}
            >
              {t("study.show")}
            </Button>
          ) : (
            <div className="grid w-full max-w-lg grid-cols-4 gap-1.5">
              {RATINGS.map(({ rating, key, button }) => (
                <Button
                  key={rating}
                  variant="outline"
                  autoFocus={rating === 3}
                  disabled={busy}
                  title={`${rating}`}
                  onClick={() => rate(rating)}
                  className={cn(
                    "flex-col gap-0 border-0 text-sm text-white hover:text-white",
                    BAR_BUTTON,
                    button,
                  )}
                >
                  {/* The interval inside; the button is still named by its rating. */}
                  <span aria-hidden className="text-[11px] opacity-90 tabular-nums">
                    {intervalOf(current.due[rating] - data.now)}
                  </span>
                  {t(`study.rating.${key}`)}
                </Button>
              ))}
            </div>
          )}
          <Counts study={data} current={current.kind} />
        </div>
        <MoreMenu
          current={current}
          buried={data.buried}
          replay={() => sound.current?.play()}
          act={act}
          onUnbury={() => actions.unbury.mutate(scope)}
        />
      </div>
      <p className="hidden text-center text-xs text-muted-foreground [@media(pointer:fine)]:block">
        {t("study.keys")}
      </p>
    </div>
  );
}
