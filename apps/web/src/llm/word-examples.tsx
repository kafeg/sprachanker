// A deck's words given examples by the AI: with a card's
// answer the examples made for the deck whose entry it shows, handed to the card (shown one at a time
// after its own), and in the word's sheet listed — the words not met yet marked and translated, each
// sentence read aloud on request —; in its corner, while there are none (and the assistant works
// here), the way to Decks to make them, with its audio's; under a deck in Review → Decks how many of
// its words have them, "Make examples", its progress with Stop, those made removed or made again. The
// reviewer's and Decks' slots (study/slots.ts).
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSetting } from "@/api/settings.ts";
import { DeckLink } from "@/study/deck-link.tsx";
import { type CardExample, ExampleLine } from "@/study/examples.tsx";
import type { DeckSlot } from "@/study/slots.ts";
import { Button } from "@/ui/components/button.tsx";
import { ConfirmButton } from "@/ui/confirm.tsx";
import { errorText } from "@/ui/error-text.ts";
import { useTimeLeft } from "@/ui/format.ts";
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

type Made = NonNullable<ReturnType<typeof useCardExamples>["data"]>;

/** The words of examples not met yet, with their translation: "heute — сегодня · …". */
const newWordsOf = (examples: Made["examples"]) => {
  const words = new Map<string, string>();
  for (const e of examples)
    for (const w of e.words) if (w.new && w.translation) words.set(w.text, w.translation);
  return [...words].map(([word, translation]) => `${word} — ${translation}`).join(" · ");
};

/** What is said under examples: the words new here, who wrote them. */
function Note({
  examples,
  model,
  t,
}: {
  examples: Made["examples"];
  model: string | null;
  t: TFunction;
}) {
  const fresh = newWordsOf(examples);
  return (
    <>
      {fresh && (
        <span className="text-muted-foreground">
          {t("examples.newWords")} {fresh}
        </span>
      )}
      {model && (
        <span className="text-xs text-muted-foreground">
          {t("examples.by", { model: modelName(model) })}
        </span>
      )}
    </>
  );
}

/** The AI's examples as shown (`note`: each says its new words and who wrote it). */
const itemsOf = (made: Made, t: TFunction, note: boolean): CardExample[] =>
  made.examples.map((e) => ({
    text: e.sentence,
    // A word not met yet is marked where it has a translation to show.
    sentence: e.words.map((w, i) =>
      w.new && w.translation ? (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed sentence
          key={i}
          title={w.translation}
          className="underline decoration-primary decoration-dotted decoration-2 underline-offset-4 not-italic"
        >
          {w.text}
        </span>
      ) : (
        w.text
      ),
    ),
    translation: e.translation,
    ...(note && { note: <Note examples={[e]} model={made.model} t={t} /> }),
  }));

/** The examples made for a word's deck, listed (its sheet). */
export function CardExamples({ cardId, deck }: { cardId: string; deck: string }) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  const off = useOff();
  const shown = useCardExamples(cardId, deck, !off);
  if (off || !shown.data?.examples.length) return null;
  return (
    <section className="grid w-full max-w-md gap-2 text-start text-sm">
      <ul className="grid gap-2">
        {itemsOf(shown.data, t, false).map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, where a sentence may come twice
          <li key={`${i} ${e.text}`}>
            <ExampleLine example={e} lang={lang} />
          </li>
        ))}
      </ul>
      <p className="grid gap-0.5">
        <Note examples={shown.data.examples} model={shown.data.model} t={t} />
      </p>
    </section>
  );
}

/** A card's answer: the examples made for its deck handed to the card; nothing shown here. */
export function CardExampleItems({
  cardId,
  deck,
  onItems,
}: {
  cardId: string;
  deck: string;
  onItems(items: CardExample[]): void;
}) {
  const { t } = useTranslation();
  const off = useOff();
  const shown = useCardExamples(cardId, deck, !off);
  const made = off ? undefined : shown.data;
  useEffect(() => onItems(made ? itemsOf(made, t, true) : []), [made, onItems, t]);
  return null;
}

/** A card's corner: the way to its deck for what it has yet to make for the word — its audio, its
 *  examples (none, none of its own, and the assistant working here). */
export function CardCorner({
  cardId,
  scope,
  audio,
  compact,
}: {
  cardId: string;
  scope: string;
  audio: boolean;
  compact?: boolean;
}) {
  const off = useOff();
  const ready = !!useLlm().data?.model;
  const shown = useCardExamples(cardId, scope, !off && ready);
  const examples = !off && ready && !!shown.data && !shown.data.own && !shown.data.examples.length;
  return <DeckLink scope={scope} audio={audio} examples={examples} compact={compact} />;
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
  const timeLeft = useTimeLeft();
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
              left: running.leftMs ? timeLeft(running.leftMs) : "",
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
  word: (card: { cardId: string; deck: string }) => <CardExamples {...card} />,
  examples: (card: { cardId: string; deck: string; onItems(items: CardExample[]): void }) => (
    <CardExampleItems {...card} />
  ),
  corner: (card: { cardId: string; scope: string; audio: boolean; compact?: boolean }) => (
    <CardCorner {...card} />
  ),
  deck: (deck: DeckSlot) => <DeckExamplesRow {...deck} />,
};
