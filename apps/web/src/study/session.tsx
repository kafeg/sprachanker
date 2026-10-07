// Studying cards as in Anki's reviewer (09) — Review's decks and a lesson's words use the same session:
// the card, the counts (new + learning + review, the current queue underlined), "Show answer", then
// Again / Hard / Good / Easy with when each brings the card back; Undo on the left, More on the right.
// Keys as in Anki: Space or Enter shows the answer and then answers Good, 1–4 rate, R replays, U or
// Ctrl+Z undoes, - and = bury, @ and ! suspend, * marks, Ctrl+1…7 flag. On a phone a tap on the card
// shows the answer and the buttons are coloured, the interval inside (AnkiDroid).
import { intervalText, SRS_DEFAULTS } from "@sprachanker/engine";
import type { CardRating } from "@sprachanker/schema";
import { Flag, MoreHorizontal, Star, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCardActions, useStudy } from "@/api/hooks.ts";
import { ErrorState, Loading } from "@/ui/app-shell.tsx";
import { Button } from "@/ui/components/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu.tsx";
import type { AudioControls } from "@/ui/media.tsx";
import { cn } from "@/ui/utils.ts";
import { type Side, StudyCard } from "./card.tsx";

/** Anki's ratings; on a phone the buttons are coloured as in AnkiDroid — in our own hues (the gender
 *  hues mean gender only, 09): Again as wrong, Good as correct, Easy as new cards. */
const RATINGS = [
  { rating: 1, key: "again", phone: "max-sm:bg-wrong max-sm:hover:bg-wrong/90" },
  { rating: 2, key: "hard", phone: "max-sm:bg-slate-600 max-sm:hover:bg-slate-700" },
  { rating: 3, key: "good", phone: "max-sm:bg-correct max-sm:hover:bg-correct/90" },
  { rating: 4, key: "easy", phone: "max-sm:bg-srs-new max-sm:hover:bg-srs-new/90" },
] as const;

/** Anki's three counts in our hues: new, learning (as Again), to review (as Good). */
export const COUNT_TONE = {
  new: "text-srs-new",
  learning: "text-wrong",
  review: "text-correct",
} as const;

/** On a Mac, Ctrl is ⌘ (the reviewer takes either). */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Anki's flag colours, 1–7 (small icons named by their colour: the one exception to the hues). */
const FLAGS = ["red", "orange", "green", "blue", "pink", "turquoise", "purple"] as const;
const FLAG_CLASS = [
  "text-red-600",
  "text-orange-500",
  "text-green-600",
  "text-blue-600",
  "text-pink-500",
  "text-teal-500",
  "text-purple-600",
];

type Study = NonNullable<ReturnType<typeof useStudy>["data"]>;

/** new + learning + review in Anki's colours; the queue of the card on screen underlined. */
export function Counts({
  counts,
  current,
  className,
}: {
  counts: Study["counts"];
  current?: "new" | "learning" | "review";
  className?: string;
}) {
  const { t } = useTranslation();
  const part = (kind: "new" | "learning" | "review", tone: string) => (
    <span className={cn("tabular-nums", tone, current === kind && "underline underline-offset-4")}>
      {counts[kind]}
    </span>
  );
  return (
    <span className={cn("text-sm", className)} title={t("study.countsTitle", counts)}>
      <span aria-hidden>
        {part("new", COUNT_TONE.new)} + {part("learning", COUNT_TONE.learning)} +{" "}
        {part("review", COUNT_TONE.review)}
      </span>
      <span className="sr-only">{t("study.countsTitle", counts)}</span>
    </span>
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
  // Counts ratings and undos, so a card back on screen (a learning step, an undo) opens anew.
  const [turn, setTurn] = useState(0);
  const sound = useRef<AudioControls>(null);
  const current = study.data?.current;
  const cardKey = current ? `${current.cardId}:${current.face}:${turn}` : "";
  // The answer is shown for one card only, so the next card opens on its question in the same render.
  const [shownFor, setShownFor] = useState<string>();
  const side: Side = cardKey && shownFor === cardKey ? "answer" : "question";
  const showAnswer = () => setShownFor(cardKey);

  const busy = actions.rate.isPending || study.isFetching;
  const rate = (rating: CardRating) => {
    if (!current || busy || side !== "answer") return;
    actions.rate.mutate(
      { cardId: current.cardId, face: current.face, rating, reps: current.reps },
      { onSuccess: () => setTurn((n) => n + 1) },
    );
  };
  const undo = () =>
    study.data?.canUndo &&
    actions.undo.mutate(undefined, { onSuccess: () => setTurn((n) => n + 1) });
  const bury = (note: boolean) =>
    current &&
    actions.bury.mutate({ cardId: current.cardId, face: note ? undefined : current.face });
  const suspend = (note: boolean) =>
    current &&
    actions.suspend.mutate({ cardId: current.cardId, face: note ? undefined : current.face });
  const flag = (n: number) =>
    current &&
    actions.flag.mutate({
      cardId: current.cardId,
      face: current.face,
      flag: current.flag === n ? 0 : n,
    });
  const mark = () =>
    current && actions.mark.mutate({ cardId: current.cardId, marked: !current.marked });

  // Anki's reviewer keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [role=dialog], [role=menu]")) return;
      // Space and Enter on a focused control are that control's (Undo, the More menu, the step
      // bar, a link) — except on the card itself.
      const control = target.closest("button, a, summary, [role=button], [role=slider]");
      if ((e.key === " " || e.key === "Enter") && control && !control.matches("[data-study-card]"))
        return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && /^Digit[1-7]$/.test(e.code)) {
        e.preventDefault();
        flag(Number(e.code.slice(5)));
        return;
      }
      if (ctrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (ctrl || e.altKey) return;
      const key = e.key;
      const act: Record<string, () => void> = {
        " ": () => (side === "question" ? showAnswer() : rate(3)),
        Enter: () => (side === "question" ? showAnswer() : rate(3)),
        "1": () => rate(1),
        "2": () => rate(2),
        "3": () => rate(3),
        "4": () => rate(4),
        r: () => sound.current?.play(),
        u: undo,
        "-": () => bury(false),
        "=": () => bury(true),
        "@": () => suspend(false),
        "!": () => suspend(true),
        "*": mark,
      };
      const run = act[key.length === 1 ? key.toLowerCase() : key] ?? act[key];
      if (!run || !current) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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

  const units = {
    s: t("study.unit.s"),
    m: t("study.unit.m"),
    h: t("study.unit.h"),
    d: t("study.unit.d"),
    mo: t("study.unit.mo"),
    y: t("study.unit.y"),
  };
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
      {/* Phone: the counts on top (AnkiDroid). */}
      <Counts counts={data.counts} current={current.kind} className="block text-center sm:hidden" />
      <StudyCard
        key={cardKey}
        display={current.display}
        face={current.face}
        side={side}
        onTap={showAnswer}
        audio={sound}
        marks={current.flag || current.marked || current.leech ? marks : undefined}
      />
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
        <div className="grid justify-items-center gap-1">
          {side === "question" ? (
            <>
              <Counts counts={data.counts} current={current.kind} className="hidden sm:block" />
              <Button
                size="lg"
                className="w-full max-w-xs text-base"
                title={t("study.showKeys")}
                onClick={showAnswer}
              >
                {t("study.show")}
              </Button>
            </>
          ) : (
            <div className="grid w-full max-w-lg grid-cols-4 gap-1.5">
              {RATINGS.map(({ rating, key, phone }) => {
                const interval = intervalText(current.due[rating] - data.now, units);
                return (
                  <div key={rating} className="grid justify-items-stretch gap-0.5">
                    <span className="hidden text-center text-xs text-muted-foreground tabular-nums sm:block">
                      {interval}
                    </span>
                    <Button
                      variant="outline"
                      autoFocus={rating === 3}
                      disabled={busy}
                      title={`${rating}`}
                      onClick={() => rate(rating)}
                      className={cn(
                        "h-auto flex-col gap-0 py-2 text-sm",
                        "max-sm:border-0 max-sm:text-white max-sm:hover:text-white",
                        phone,
                      )}
                    >
                      {/* Phone: the interval inside; the button is still named by its rating. */}
                      <span aria-hidden className="text-[11px] opacity-90 sm:hidden">
                        {interval}
                      </span>
                      {t(`study.rating.${key}`)}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("study.more")}>
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => sound.current?.play()}
              disabled={!current.display.audio}
            >
              {t("study.replay")}
              <DropdownMenuShortcut>R</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => bury(false)}>
              {t("study.buryCard")}
              <DropdownMenuShortcut>-</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => bury(true)}>
              {t("study.buryNote")}
              <DropdownMenuShortcut>=</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => suspend(false)}>
              {t("study.suspendCard")}
              <DropdownMenuShortcut>@</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => suspend(true)}>
              {t("study.suspendNote")}
              <DropdownMenuShortcut>!</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={mark}>
              {current.marked ? t("study.unmark") : t("study.mark")}
              <DropdownMenuShortcut>*</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {FLAGS.map((name, i) => (
              <DropdownMenuItem key={name} onSelect={() => flag(i + 1)}>
                <Flag className={cn("size-4 fill-current", FLAG_CLASS[i])} />
                {t(`study.flag.${name}`)}
                {current.flag === i + 1 && " ✓"}
                <DropdownMenuShortcut>
                  {MAC ? `⌘${i + 1}` : t("study.flagKey", { n: i + 1 })}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="hidden text-center text-xs text-muted-foreground [@media(pointer:fine)]:block">
        {t("study.keys")}
      </p>
    </div>
  );
}
