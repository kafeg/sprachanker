// The voice for words (Settings → Speech → Read aloud; owner, 2026-10-15): Qwen3-TTS's Base model
// to download, and for each language it speaks a voice taken from a recording of a course in it — the
// sentence the recording says, "Listen" (a word read in the voice), "Another recording" (the next the
// server proposes). The first time the model and a course of the language are here, the first one
// proposed is taken, so it works with nothing chosen. A recording is decoded here and sent as 24 kHz
// WAV (wav.ts): the server has no decoder.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Volume2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import {
  type QwenState,
  sendWordVoice,
  useQwenModelActions,
  useWordCandidates,
  type WordCandidate,
} from "@/api/speech.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { errorText } from "@/ui/error-text.ts";
import { DownloadRow } from "./download-row.tsx";
import { sampleWord } from "./samples.ts";
import { useReadingWait, useSpeaker } from "./speaker.ts";
import { toVoiceWav } from "./wav.ts";

export function WordVoices({ state, langs }: { state: QwenState; langs: string[] }) {
  const { t } = useTranslation();
  const actions = useQwenModelActions();
  const model = state.wordModel;
  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-medium">{t("speech.settings.words.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("speech.settings.words.hint")}</p>
      <ul>
        <DownloadRow
          title={t("speech.settings.words.model")}
          item={model}
          removeLabel={t("speech.settings.removeModel")}
          starting={actions.download.isPending && actions.download.variables === model.id}
          onDownload={() => actions.download.mutate(model.id)}
          onRemove={() => actions.remove.mutate(model.id)}
        />
      </ul>
      {model.installed && (
        <div>
          {langs
            .filter((lang) => state.languages.includes(lang))
            .map((lang) => (
              <WordVoice key={lang} lang={lang} voice={state.words[lang]} />
            ))}
        </div>
      )}
    </div>
  );
}

/** One language's voice for words: the sentence it was taken from, "Listen", "Another recording". */
function WordVoice({ lang, voice }: { lang: string; voice?: QwenState["words"][string] }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const speaker = useSpeaker();
  const candidates = useWordCandidates(lang);
  const list = candidates.data ?? [];
  const take = useMutation({
    mutationFn: async (recording: WordCandidate) => {
      const res = await fetch(mediaUrl(recording.series, recording.path)).catch(() => undefined);
      if (!res?.ok) throw new Error("no_such_recording");
      const wav = await toVoiceWav(await res.blob()).catch(() => {
        throw new Error("unsupported_audio");
      });
      return sendWordVoice(lang, recording, wav);
    },
    onSuccess: (state) => client.setQueryData(["qwen-tts"], state),
  });
  const { mutate } = take;
  // None taken yet: the first recording proposed, once.
  const tried = useRef(false);
  const first = list[0];
  useEffect(() => {
    if (voice || !first || tried.current) return;
    tried.current = true;
    mutate(first);
  }, [voice, first, mutate]);
  // The next after the voice taken — or after the recording that could not be taken.
  const from = voice ?? (take.isError ? take.variables : undefined);
  const at = from ? list.findIndex((c) => c.series === from.series && c.path === from.path) : -1;
  const next = list.length > 1 || at < 0 ? list[(at + 1) % list.length] : undefined;
  const id = `words:${lang}`;
  const starting = useReadingWait() === id;
  const name = languageName(lang, i18n.language, true);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <span className="w-28 text-sm font-medium">{name}</span>
      <span className="min-w-0 flex-1 text-sm">
        {voice ? (
          <q lang={lang} dir="auto">
            {voice.text}
          </q>
        ) : take.isPending ? (
          <span className="text-muted-foreground">{t("speech.settings.words.taking")}</span>
        ) : (
          candidates.isSuccess &&
          !list.length && (
            <span className="text-muted-foreground">
              {t("speech.settings.words.none", { language: name })}
            </span>
          )
        )}
      </span>
      {voice && (
        <Button
          variant="outline"
          size="sm"
          loading={starting}
          onClick={() => void speaker.say(id, [{ text: sampleWord(lang), lang, words: true }])}
        >
          {!starting && <Volume2 className="size-4" />} {t("speech.settings.listen")}
        </Button>
      )}
      {(voice || take.isError) && next && (
        <Button
          variant="outline"
          size="sm"
          loading={take.isPending}
          onClick={() => take.mutate(next)}
        >
          {!take.isPending && <RefreshCw className="size-4" />} {t("speech.settings.words.another")}
        </Button>
      )}
      {take.isError && (
        <p role="alert" className="basis-full text-sm text-wrong">
          {errorText(t, take.error)}
        </p>
      )}
    </div>
  );
}
