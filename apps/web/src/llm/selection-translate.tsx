// "Translate" in the bar of words selected anywhere (owner, 2026-10-15), while a model is set up: the
// model tells which language they are in; the words in the language learnt are said aloud (their
// audio made for the deck, else read now), shown with their translation, and kept as a card of the
// learner's deck "Finds" by themselves — or said to be among the cards already; pressed again, said
// again. The selection menu's
// optional actions (audio/selection-menu.tsx: `extra`).
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fileUrl } from "@/api/client.ts";
import type { Picked } from "@/audio/selection-menu.tsx";
import { said } from "@/audio/speak.ts";
import { useSpeaker } from "@/audio/speaker.ts";
import { Button } from "@/ui/components/button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { useFind } from "./api.ts";
import { ErrorLine } from "./parts.tsx";
import { useLlm } from "./setup-api.ts";

export function SelectionTranslate({ picked }: { picked: Picked }) {
  const { t } = useTranslation();
  const llm = useLlm();
  const speaker = useSpeaker();
  const find = useFind();
  if (!llm.data?.model) return null;
  type Found = NonNullable<typeof find.data>;
  const play = (found: Found) =>
    speaker.say(
      `find:${found.target}`,
      found.audio
        ? [{ text: found.target, lang: found.lang, src: fileUrl(found.audio) }]
        : said(found.target, found.lang),
    );
  const found = find.data;
  // Translated: pressed again, said again — the model is not asked twice.
  const translate = () =>
    found
      ? play(found)
      : find.mutate(
          { text: picked.text, context: picked.context, lang: picked.lang },
          { onSuccess: play },
        );
  return (
    <>
      <Button variant="ghost" size="sm" loading={find.isPending} onClick={translate}>
        {!find.isPending && <Languages />} {t("selection.translate")}
      </Button>
      {found && (
        <p className="basis-full px-2 pb-1 text-sm" aria-live="polite">
          <span className="font-semibold" {...inLang(found.lang)}>
            {found.target}
          </span>{" "}
          — {found.translation}
          <span className="block text-xs text-muted-foreground">
            {found.added ? t("selection.added") : t("selection.had")}
          </span>
        </p>
      )}
      {find.isError && (
        <div className="basis-full px-2 pb-1">
          <ErrorLine
            error={find.error}
            provider={llm.data.provider ?? undefined}
            onRetry={translate}
          />
        </div>
      )}
    </>
  );
}
