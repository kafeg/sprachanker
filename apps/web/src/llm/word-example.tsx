// AI examples for a word (04; 07): on request only — "Example" under a card's answer or in the word's
// sheet shows the newest kept for the card, or asks the model when none is; "Another example" asks
// again. The sentence marks words the learner has not met in the course yet, translated under it.

import { Link } from "@tanstack/react-router";
import { LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { said } from "@/audio/speak.ts";
import { SpeakButton } from "@/audio/speak-button.tsx";
import { Button } from "@/ui/components/button.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { useAiIn, useExamples, useLlm, useMakeExample } from "./api.ts";
import { modelName } from "./assistant-label.tsx";
import { ErrorLine } from "./parts.tsx";
import { PromptButton } from "./prompt-view.tsx";

export function WordExample({ cardId }: { cardId: string }) {
  const { t, i18n } = useTranslation();
  const lang = useTargetLang();
  const llm = useLlm();
  const [open, setOpen] = useState(false);
  const kept = useExamples(cardId, open);
  const make = useMakeExample(cardId);
  const asked = useRef(false);
  const ready = !!llm.data?.model;
  const shown = kept.data?.examples[0];
  const ask = () => make.mutate(i18n.language);

  // Opened without one kept: asked for at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once, when opened and read
  useEffect(() => {
    if (!open || !ready || !kept.isSuccess || shown || asked.current) return;
    asked.current = true;
    ask();
  }, [open, ready, kept.isSuccess]);

  if (!llm.data) return null;
  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="size-4" /> {t("example.show")}
      </Button>
    );
  if (!ready && kept.isSuccess && !shown)
    return (
      <Link to="/settings" hash="ai" className="text-sm text-muted-foreground underline">
        {t("example.setUp")}
      </Link>
    );

  const fresh = make.data && make.data.ts === shown?.ts;
  const promptRequest = { example: { cardId, language: i18n.language } };
  const newWords = (shown?.words ?? []).filter((w) => w.new && w.translation);
  return (
    <div className="w-full rounded-xl border bg-muted/50 px-4 py-3 text-left" aria-live="polite">
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Sparkles className="size-4" /> {t("example.title")}
        {shown && <span className="font-normal">· {modelName(shown.model)}</span>}
        {(make.isPending || kept.isPending) && <LoaderCircle className="size-4 animate-spin" />}
        <span className="ml-auto flex items-center gap-1">
          {shown && ready && !make.isPending && (
            <Button variant="ghost" size="sm" className="h-8" onClick={ask}>
              <RotateCcw className="size-3.5" /> {t("example.another")}
            </Button>
          )}
          <PromptButton request={promptRequest} />
        </span>
      </div>
      {shown ? (
        <div className={fresh ? "motion-safe:animate-in motion-safe:fade-in" : undefined}>
          <p lang={lang} className="text-lg">
            <SpeakButton
              parts={said(shown.words.map((w) => w.text).join(""), lang)}
              className="float-right -mr-2"
            />
            {shown.words.map((w, i) =>
              w.new ? (
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
          </p>
          <p className="text-muted-foreground">{shown.translation}</p>
          {newWords.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("example.newWords")}{" "}
              {newWords.map((w) => `${w.text} — ${w.translation}`).join(" · ")}
            </p>
          )}
        </div>
      ) : (
        make.isPending && <p className="text-muted-foreground">{t("llm.thinking")}</p>
      )}
      <ErrorLine error={make.error ?? kept.error} provider={llm.data.provider ?? undefined}>
        {" "}
        <button type="button" className="underline" onClick={ask}>
          {t("common.retry")}
        </button>
      </ErrorLine>
    </div>
  );
}

/** The reviewer's and the word sheet's slots (study/slots.ts). */
export const wordAssistant = {
  word: ({ cardId }: { cardId: string }) => <WordSlot cardId={cardId} />,
};

/** A word's example, while its place is on (Settings → Prompts). */
function WordSlot({ cardId }: { cardId: string }) {
  return useAiIn("example") ? <WordExample cardId={cardId} /> : null;
}
