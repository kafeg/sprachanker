// The word sheet (09): a word with cards in full — its forms and translation, an example, its audio,
// where it was met, each card type's state and the answers given to it — with suspend, mark and the way
// to its lesson. A side panel; full width on a phone.
import { type CardFace, parseLessonKey } from "@sprachanker/schema";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Pause, Play, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type MyWord, useCardActions, useWord } from "@/api/cards.ts";
import { cardAudioUrl } from "@/api/client.ts";
import { Button } from "@/ui/components/button.tsx";
import { useDateFormat } from "@/ui/format.ts";
import { AudioButton } from "@/ui/media.tsx";
import { ErrorState, Loading } from "@/ui/page.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";
import { TargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { GenderWord } from "@/word/word.tsx";
import { DeckLink, deckOf } from "./deck-link.tsx";
import { useDeckName } from "./decks.ts";
import { DeckExamples } from "./examples.tsx";
import { useStudySlots } from "./slots.ts";
import { useDueText } from "./time.ts";
import { COUNT_TONE, ratingOf } from "./tones.ts";

/** The sheet of `word` (the list's latest copy of it, so suspend and mark show at once). */
export function WordSheet({ word, onClose }: { word: MyWord | undefined; onClose(): void }) {
  const { t } = useTranslation();
  return (
    <SideSheet
      open={!!word}
      onOpenChange={(open) => !open && onClose()}
      title={t("myWords.sheet")}
      className="overflow-y-auto sm:max-w-md"
    >
      {word && (
        <TargetLang value={word.lang}>
          <WordDetails word={word} />
        </TargetLang>
      )}
    </SideSheet>
  );
}

function WordDetails({ word }: { word: MyWord }) {
  const { t } = useTranslation();
  const sheet = useWord(word.cardId);
  const actions = useCardActions();
  const slots = useStudySlots();
  const due = useDueText();
  const when = useDateFormat("day");
  const deckName = useDeckName();
  const d = word.display;
  const audio = cardAudioUrl(d);
  const lesson =
    "lessonKey" in d ? { series: d.series, ...parseLessonKey(d.lessonKey) } : undefined;
  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <GenderWord text={d.target} gender={d.gender} className="text-2xl" />
          {audio && <AudioButton src={audio} label={d.target} className="size-11" />}
          {/* What its deck has yet to make for it: the way to Decks (never read on the fly). */}
          <span className="text-right">
            {slots.corner ? (
              slots.corner({ cardId: word.cardId, scope: deckOf(d), audio: !audio })
            ) : (
              <DeckLink scope={deckOf(d)} audio={!audio} />
            )}
          </span>
        </div>
        {d.translation && <p className="text-lg">{d.translation}</p>}
        {d.example && (
          <p lang={word.lang} className="text-muted-foreground">
            {d.example}
          </p>
        )}
        <DeckExamples display={d} lang={word.lang} className="pt-1" />
        <div className="-ml-2">{slots.word?.({ cardId: word.cardId })}</div>
        {lesson ? (
          <Link
            to="/lesson/$series/$course/$lesson"
            params={{ series: lesson.series, course: lesson.courseId, lesson: lesson.name }}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline"
          >
            {t("myWords.toLesson", { unit: lesson.unit, lesson: lesson.lesson })}{" "}
            <ArrowRight className="size-4" />
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("myWords.fromDeck", { deck: deckName(word.deck) })}
          </p>
        )}
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
                    <span className={cn("font-medium", ratingOf(a.rating).tone)}>
                      {t(`study.rating.${ratingOf(a.rating).key}`)}
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
