// A deck's words given examples by the AI (04, "A deck's words given examples"; 07; 09): under a card's
// answer and in the word's sheet the examples made for its deck — the words not met yet marked and
// translated, each sentence read aloud on request —; in its corner, while there are none (and the
// assistant works here), the way to Decks to make them, with its audio's; under a deck in Review →
// Decks how many of its words have none, "Make examples", its progress with Stop. The reviewer's and
// Decks' slots (study/slots.ts).
import { Link } from "@tanstack/react-router";
import { RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSetting } from "@/api/settings.ts";
import { said } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { DeckLink } from "@/study/deck-link.tsx";
import type { DeckSlot } from "@/study/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { ConfirmButton } from "@/ui/confirm.tsx";
import { inLang } from "@/ui/direction.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useDuration } from "@/ui/format.ts";
import { JobRow } from "@/ui/job-row.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import { useCardExamples, useDeckExamples, useDeckExamplesActions, writing } from "./api.ts";
import { modelName } from "./assistant-label.tsx";
import { PromptButton } from "./prompt-view.tsx";
import { useLlm } from "./setup-api.ts";

const LINK = "inline-flex items-center underline pointer-coarse:min-h-11";

/** Whether the learner turned a word's examples off (Settings → AI assistant). */
const useOff = () => useSetting("llm.offIn").includes("example");

/** A card's examples made for its deck. */
export function CardExamples({ cardId }: { cardId: string }) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const off = useOff();
  const shown = useCardExamples(cardId, !off);
  if (off || !shown.data) return null;
  const { examples, model } = shown.data;
  if (!examples.length) return null;
  const newWords = new Map<string, string>();
  for (const e of examples)
    for (const w of e.words) if (w.new && w.translation) newWords.set(w.text, w.translation);
  return (
    <section className="grid w-full max-w-md gap-2 text-start text-sm">
      <ul className="grid gap-2">
        {examples.map((e, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, where a sentence may come twice
            key={`${i} ${e.sentence}`}
            className="flex items-start gap-2"
          >
            <SpeakButton
              parts={said(e.sentence, lang)}
              label={e.sentence}
              className="size-9 shrink-0 pointer-coarse:size-11"
            />
            <span className="grid gap-0.5">
              <span {...inLang(lang)}>
                {/* A word not met yet is marked where it has a translation to show. */}
                {e.words.map((w, i) =>
                  w.new && w.translation ? (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed sentence
                      key={i}
                      title={w.translation}
                      className="underline decoration-primary decoration-dotted decoration-2 underline-offset-4"
                    >
                      {w.text}
                    </span>
                  ) : (
                    w.text
                  ),
                )}
              </span>
              <span className="text-muted-foreground">{e.translation}</span>
            </span>
          </li>
        ))}
      </ul>
      {newWords.size > 0 && (
        <p className="text-muted-foreground">
          {t("examples.newWords")}{" "}
          {[...newWords].map(([word, translation]) => `${word} — ${translation}`).join(" · ")}
        </p>
      )}
      {model && (
        <p className="text-xs text-muted-foreground">
          {t("examples.by", { model: modelName(model) })}
        </p>
      )}
    </section>
  );
}

/** A card's corner: the way to its deck for what it has yet to make for the word — its audio, its
 *  examples (none, none of its own, and the assistant working here). */
export function CardCorner({
  cardId,
  scope,
  audio,
}: {
  cardId: string;
  scope: string;
  audio: boolean;
}) {
  const off = useOff();
  const ready = !!useLlm().data?.model;
  const shown = useCardExamples(cardId, !off && ready);
  const examples = !off && ready && !!shown.data && !shown.data.own && !shown.data.examples.length;
  return <DeckLink scope={scope} audio={audio} examples={examples} />;
}

/** A deck in Review → Decks (`DeckSlot`): under a deck to take, its words in a language pair given
 *  examples by the AI on request, removed or made again (asked first); under a deck taken, how it
 *  stands in a line (`status`). */
export function DeckExamplesRow(deck: DeckSlot) {
  const off = useOff();
  return off ? null : <DeckExamplesJob {...deck} />;
}

function DeckExamplesJob({ scope, edition, title = "", status, className }: DeckSlot) {
  const { t } = useTranslation();
  const llm = useLlm();
  const state = useDeckExamples(scope, edition);
  const actions = useDeckExamplesActions(scope, edition);
  const duration = useDuration();
  const s = state.data;
  if (!s?.words || !llm.data) return null;
  const job = s.job;
  const running = writing(s) ? job : null;
  if (status) {
    const line = running
      ? t("decks.examples.writing", { done: running.done, total: running.total })
      : s.missing
        ? t("decks.examples.missing", { count: s.missing })
        : s.made
          ? t("decks.examples.all")
          : null;
    return line ? <p className={cn("text-sm text-muted-foreground", className)}>{line}</p> : null;
  }
  const model = !!llm.data.model;
  const error = actions.start.error ?? actions.stop.error ?? actions.remove.error;
  const cancel = t("common.cancel");
  return (
    <JobRow
      className={className}
      running={
        running
          ? {
              status: t("decks.examples.writing", { done: running.done, total: running.total }),
              left: running.leftMs ? t("decks.left", { time: duration(running.leftMs) }) : "",
              done: running.done,
              total: running.total,
              stopping: actions.stop.isPending || running.status === "stopping",
              stop: t("decks.audio.stop"),
              onStop: () => actions.stop.mutate(),
            }
          : undefined
      }
      idle={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-muted-foreground">
            {t("decks.examples.count", { done: s.own + s.made, total: s.words })}
          </span>
          {model && s.missing > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                loading={actions.start.isPending}
                onClick={() => actions.start.mutate(false)}
              >
                <Sparkles className="size-3.5" /> {t("decks.examples.make")}
              </Button>
              <PromptButton request={{ deckExamples: { scope, edition } }} />
            </>
          )}
          {model && s.made > 0 && (
            <ConfirmButton
              title={t("decks.examples.regenerateTitle", { deck: title })}
              description={t("decks.examples.regenerateBody")}
              confirm={t("decks.examples.regenerate")}
              cancel={cancel}
              busy={actions.start.isPending}
              onConfirm={(close) => actions.start.mutate(true, { onSettled: close })}
            >
              <RefreshCw className="size-3.5" /> {t("decks.examples.regenerate")}
            </ConfirmButton>
          )}
          {s.made > 0 && (
            <ConfirmButton
              title={t("decks.examples.removeTitle", { deck: title })}
              description={t("decks.examples.removeBody")}
              confirm={t("decks.examples.remove")}
              cancel={cancel}
              busy={actions.remove.isPending}
              onConfirm={(close) => actions.remove.mutate(undefined, { onSettled: close })}
            >
              <Trash2 className="size-3.5" /> {t("decks.examples.remove")}
            </ConfirmButton>
          )}
          {!model && s.missing > 0 && (
            <Link to="/settings" hash="ai" className={LINK}>
              {t("decks.examples.setUp")}
            </Link>
          )}
        </div>
      }
      failed={
        !running && job?.failed && s.missing ? (
          <p>
            {t("decks.examples.failed", { count: job.failed })}
            {job.error && ` ${t("decks.why", { reason: errorText(t, job.error) })}`}
          </p>
        ) : undefined
      }
      error={error ? errorText(t, error) : undefined}
    />
  );
}

/** The reviewer's, the word sheet's and Decks' slots (study/slots.ts). */
export const examplesAssistant = {
  word: ({ cardId }: { cardId: string }) => <CardExamples cardId={cardId} />,
  corner: (card: { cardId: string; scope: string; audio: boolean }) => <CardCorner {...card} />,
  deck: (deck: DeckSlot) => <DeckExamplesRow {...deck} />,
};
