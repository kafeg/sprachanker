// "Translate" in the bar of words selected anywhere (owner, 2026-10-15), while a model is set up: the
// model tells which language they are in; the words in the language learnt are shown with their
// translation as soon as it answers, and kept as a card of the learner's deck "Finds" by themselves —
// or said to be among the cards already. Their audio comes after: made by the server for the deck (a
// spinner beside them meanwhile; in the voice for words where there is one), then played once by
// itself; the play button says them again. The selection menu's optional actions
// (audio/selection-menu.tsx: `extra`).
import { Languages, LoaderCircle, Volume2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { fileUrl } from "@/api/client.ts";
import type { Picked } from "@/audio/selection-menu.tsx";
import { wordsSaid } from "@/audio/speak.ts";
import { useSpeaker } from "@/audio/speaker.ts";
import { Button } from "@/ui/components/button.tsx";
import { inLang } from "@/ui/direction.tsx";
import { useFind, useFindAudio } from "./api.ts";
import { ErrorLine } from "./parts.tsx";
import { useLlm } from "./setup-api.ts";

export function SelectionTranslate({ picked }: { picked: Picked }) {
  const { t } = useTranslation();
  const llm = useLlm();
  const speaker = useSpeaker();
  const find = useFind();
  const made = useFindAudio();
  type Found = NonNullable<typeof find.data>;
  const id = (found: Found) => `find:${found.target}`;
  /** The words said: their audio in Finds, else read now. */
  const play = (found: Found, audio: string | null | undefined) =>
    speaker.say(
      id(found),
      audio
        ? [{ text: found.target, lang: found.lang, src: fileUrl(audio) }]
        : wordsSaid(found.target, found.lang),
    );
  const found = find.data;
  const audio = found?.audio ?? made.data?.audio;
  // Shown: their audio played once it is there — made for Finds first when it is still to be. Started by
  // what was found, not by the request's callback (one a busy page may never call).
  const started = useRef(false);
  useEffect(() => {
    if (!found || started.current) return;
    started.current = true;
    if (found.audio || !found.word) void play(found, found.audio);
    else made.mutate(found.word);
  });
  const played = useRef(false);
  useEffect(() => {
    if (!found || played.current || (!made.isSuccess && !made.isError)) return;
    played.current = true;
    void play(found, made.data?.audio ?? null);
  });
  // Translated: pressed again, said again — the model is not asked twice.
  const translate = () =>
    found
      ? play(found, audio)
      : find.mutate({ text: picked.text, context: picked.context, lang: picked.lang });
  const toMake = !!found && !found.audio && !!found.word && made.isIdle;
  if (!llm.data?.model) return null;
  const making = toMake || made.isPending || (!!found && speaker.waiting === id(found));
  return (
    <>
      <Button variant="ghost" size="sm" loading={find.isPending} onClick={translate}>
        {!find.isPending && <Languages />} {t("selection.translate")}
      </Button>
      {found && (
        <div className="flex basis-full items-start gap-2 px-2 pb-1">
          <p className="min-w-0 flex-1 text-sm" aria-live="polite">
            <span className="font-semibold" {...inLang(found.lang)}>
              {found.target}
            </span>{" "}
            — {found.translation}
            <span className="block text-xs text-muted-foreground">
              {found.added ? t("selection.added") : t("selection.had")}
            </span>
          </p>
          {making ? (
            <span
              role="status"
              aria-label={t("selection.audioMaking")}
              className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label={t("selection.listen")}
              onClick={() => void play(found, audio)}
            >
              <Volume2 />
            </Button>
          )}
        </div>
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
