// A deck's words given examples by the AI (04, "A deck's words given examples"; 07; 09): under a card's
// answer and in the word's sheet the examples made for its deck — the words not met yet marked and
// translated, each sentence read aloud on request —; in its corner, while there are none (and the
// assistant works here), the way to Decks to make them, with its audio's; under a deck in Review →
// Decks how many of its words have none, "Make examples", its progress with Stop. The reviewer's and
// Decks' slots (study/slots.ts).
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSetting } from "@/api/settings.ts";
import { said } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { DeckLink } from "@/study/deck-link.tsx";
import { Button } from "@/ui/components/button.tsx";
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
    <section className="grid w-full max-w-md gap-2 text-left text-sm">
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
              <span lang={lang}>
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

/** Under a deck in Review → Decks: its words without examples, made by the AI on request. */
export function DeckExamplesRow({ scope, className }: { scope: string; className?: string }) {
  const off = useOff();
  return off ? null : <DeckExamplesJob scope={scope} className={className} />;
}

function DeckExamplesJob({ scope, className }: { scope: string; className?: string }) {
  const { t } = useTranslation();
  const llm = useLlm();
  const state = useDeckExamples(scope);
  const actions = useDeckExamplesActions(scope);
  const duration = useDuration();
  const s = state.data;
  if (!s?.words || !llm.data) return null;
  const job = s.job;
  const running = writing(s) ? job : null;
  if (!running && !s.missing)
    return s.made ? (
      <p className={cn("text-sm text-muted-foreground", className)}>{t("decks.examples.all")}</p>
    ) : null;
  const error = actions.start.error ?? actions.stop.error;
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
            {t("decks.examples.missing", { count: s.missing })}
          </span>
          {llm.data.model ? (
            <>
              <Button
                variant="outline"
                size="sm"
                loading={actions.start.isPending}
                onClick={() => actions.start.mutate()}
              >
                <Sparkles className="size-3.5" /> {t("decks.examples.make")}
              </Button>
              <PromptButton request={{ deckExamples: { scope } }} />
            </>
          ) : (
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
  deck: ({ scope, className }: { scope: string; className?: string }) => (
    <DeckExamplesRow scope={scope} className={className} />
  ),
};
