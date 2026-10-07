// The word sheet (09): a word with cards in full — its forms and translation, an example, its audio,
// where it was met, each card type's state and the answers given to it — with suspend, mark and the way
// to its lesson. A side panel; full width on a phone.
import { type CardFace, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Pause, Play, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { type MyWord, useCardActions, useWord } from "@/api/hooks.ts";
import { COUNT_TONE, useIntervalText } from "@/study/session.tsx";
import { ErrorState, Loading } from "@/ui/app-shell.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/components/sheet.tsx";
import { AudioButton } from "@/ui/media.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { GenderWord } from "./word.tsx";

const RATING = ["again", "hard", "good", "easy"] as const;
const RATING_TONE = ["text-wrong", "text-muted-foreground", "text-correct", "text-srs-new"];

/** When a face or word is next due: now, or in how long. */
export function useDueText() {
  const { t } = useTranslation();
  const interval = useIntervalText();
  return (due: number | null, now = Date.now()) =>
    due === null
      ? "—"
      : due <= now
        ? t("myWords.dueNow")
        : t("myWords.dueIn", { interval: interval(due - now) });
}

/** The sheet of `word` (the list's latest copy of it, so suspend and mark show at once). */
export function WordSheet({ word, onClose }: { word: MyWord | undefined; onClose(): void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={!!word} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="pb-2">
          <SheetTitle>{t("myWords.sheet")}</SheetTitle>
        </SheetHeader>
        {word && (
          <TargetLang value={word.lang}>
            <WordDetails word={word} />
          </TargetLang>
        )}
      </SheetContent>
    </Sheet>
  );
}

function WordDetails({ word }: { word: MyWord }) {
  const { t, i18n } = useTranslation();
  const sheet = useWord(word.cardId);
  const actions = useCardActions();
  const due = useDueText();
  const when = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" });
  const d = word.display;
  const lesson = parseLessonKey(d.lessonKey);
  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <GenderWord text={d.target} gender={d.gender} className="text-2xl" />
          {d.audio && (
            <AudioButton src={mediaUrl(d.series, d.audio)} label={d.target} className="size-11" />
          )}
        </div>
        {d.translation && <p className="text-lg">{d.translation}</p>}
        {d.example && (
          <p lang={word.lang} className="text-muted-foreground">
            {d.example}
          </p>
        )}
        <Link
          to="/lesson/$series/$course/$lesson"
          params={{ series: d.series, course: lesson.courseId, lesson: lesson.name }}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline"
        >
          {t("myWords.toLesson", { unit: lesson.unit, lesson: lesson.lesson })}{" "}
          <ArrowRight className="size-4" />
        </Link>
      </div>

      {sheet.isPending ? (
        <Loading />
      ) : sheet.isError ? (
        <ErrorState error={sheet.error} onRetry={() => sheet.refetch()} />
      ) : (
        <>
          <section>
            <h3 className="mb-1 font-semibold">{t("myWords.cards")}</h3>
            <ul className="divide-y rounded-xl border">
              {sheet.data.faces.map((f) => (
                <li key={f.face} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1">{t(`myWords.face.${f.face as CardFace}`)}</span>
                  {f.lapses > 0 && (
                    <span className="text-muted-foreground">
                      {t("myWords.lapses", { count: f.lapses })}
                    </span>
                  )}
                  <span className={f.suspended ? "text-muted-foreground" : COUNT_TONE[f.stage]}>
                    {f.suspended ? t("myWords.state.suspended") : t(`myWords.state.${f.stage}`)}
                  </span>
                  <span className="w-20 text-right text-muted-foreground">
                    {f.suspended || word.suspended ? "—" : due(f.due)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-1 font-semibold">{t("myWords.answers")}</h3>
            {sheet.data.answers.length ? (
              <ul className="space-y-1 text-sm">
                {sheet.data.answers.map((a) => (
                  <li key={`${a.ts}-${a.face}`} className="flex gap-3">
                    <span className="w-16 shrink-0 text-muted-foreground">{when.format(a.ts)}</span>
                    <span className="flex-1">{t(`myWords.face.${a.face as CardFace}`)}</span>
                    <span className={cn("font-medium", RATING_TONE[a.rating - 1])}>
                      {t(`study.rating.${RATING[a.rating - 1]}`)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("myWords.noAnswers")}</p>
            )}
          </section>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            actions.suspend.mutate({ cardId: word.cardId, suspended: !word.suspended })
          }
        >
          {word.suspended ? <Play className="size-4" /> : <Pause className="size-4" />}
          {word.suspended ? t("myWords.unsuspend") : t("myWords.suspend")}
        </Button>
        <Button
          variant="outline"
          onClick={() => actions.mark.mutate({ cardId: word.cardId, marked: !word.marked })}
        >
          <Star className={cn("size-4", word.marked && "fill-current text-amber-500")} />
          {word.marked ? t("study.unmark") : t("study.mark")}
        </Button>
      </div>
    </div>
  );
}
