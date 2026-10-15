// The voice for words (Settings → Speech → Read aloud; owner, 2026-10-15): Qwen3-TTS's Base model
// to download, and for each language it speaks a voice taken from a recording of a course in it — the
// recording chosen from those the server proposes (its sentence shown; the recording itself to hear),
// "Listen" reading a text in the voice — a word, sentences, the learner's own (voice-pick.tsx). The first time the model and a course of the language are here, the first one
// proposed is taken, so it works with nothing chosen. A recording is decoded here and sent as 24 kHz
// WAV (wav.ts): the server has no decoder.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "@/api/client.ts";
import { useCourseEdition } from "@/api/edition.ts";
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
import { useClip } from "@/ui/playback.tsx";
import { DownloadRow } from "./download-row.tsx";
import { samplesOf, sampleWord } from "./samples.ts";
import { useSpeaker } from "./speaker.ts";
import { VoicePick } from "./voice-pick.tsx";
import { toVoiceWav, voiceGender } from "./wav.ts";

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

/** A recording's id among the options. */
const keyOf = (r: { series: string; path: string }) => `${r.series}\n${r.path}`;

/** One language's voice for words, in the row the speakers have: the recording it is taken from (its
 *  sentence; another one chosen from the list), the recording itself to hear, "Listen" reading the
 *  text below in the voice — a word first, sentences on request, or the learner's own. */
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
  const name = languageName(lang, i18n.language, true);
  // The voice taken stays among the options when the courses no longer propose it.
  const options = voice && !list.some((c) => keyOf(c) === keyOf(voice)) ? [voice, ...list] : list;
  const shown = take.isPending ? take.variables : voice;
  const id = `words:${lang}`;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <span className="w-28 text-sm font-medium">{name}</span>
      {options.length ? (
        <VoicePick
          lang={lang}
          listenId={id}
          phrases={[sampleWord(lang), ...samplesOf(lang)]}
          pick={{
            options: options.map((c) => ({
              id: keyOf(c),
              name: c.text,
              detail: <RecordingDetail recording={c} />,
            })),
            value: shown ? keyOf(shown) : "",
            label: t("speech.settings.words.recordingFor", { language: name }),
            inLang: true,
            onChange: (key) => {
              const recording = options.find((c) => keyOf(c) === key);
              if (recording) mutate(recording);
            },
          }}
          note={t("speech.settings.words.sample")}
          onListen={(text) => void speaker.say(id, [{ text, lang, words: true }])}
          beside={
            <>
              {voice && <RecordingButton series={voice.series} path={voice.path} />}
              {take.isPending && (
                <span className="text-sm text-muted-foreground" role="status">
                  {t("speech.settings.words.taking")}
                </span>
              )}
            </>
          }
        />
      ) : (
        candidates.isSuccess && (
          <span className="text-sm text-muted-foreground">
            {t("speech.settings.words.none", { language: name })}
          </span>
        )
      )}
      {take.isError && (
        <p role="alert" className="basis-full text-sm text-wrong">
          {errorText(t, take.error)}
        </p>
      )}
    </div>
  );
}

/** Decodings one at a time: a list of recordings is not decoded all at once. */
let decoding: Promise<unknown> = Promise.resolve();
const oneByOne = <T,>(job: () => Promise<T>) => {
  const done = decoding.then(job);
  decoding = done.catch(() => undefined);
  return done;
};

/** Where a recording is met — its course, the lesson's number — and who says it, a man or a woman
 *  (by its pitch: said only when clear). */
function RecordingDetail({ recording }: { recording: WordCandidate }) {
  const { t } = useTranslation();
  const { info, edition } = useCourseEdition(recording.series, recording.course ?? "");
  const gender = useQuery({
    queryKey: ["voice-gender", recording.series, recording.path],
    queryFn: () =>
      oneByOne(async () => {
        const res = await fetch(mediaUrl(recording.series, recording.path));
        if (!res.ok) return null;
        return (await voiceGender(await res.blob()).catch(() => undefined)) ?? null;
      }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const course = (edition && info?.titles[edition]) || info?.key;
  const parts = [
    course && recording.lesson
      ? t("speech.settings.words.where", { course, lesson: recording.lesson })
      : course,
    gender.data &&
      (gender.data === "male"
        ? t("speech.settings.words.male")
        : t("speech.settings.words.female")),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The course's recording the voice is taken from, as it is. */
function RecordingButton({ series, path }: { series: string; path: string }) {
  const { t } = useTranslation();
  const { playing, toggle } = useClip(mediaUrl(series, path));
  return (
    <Button variant="outline" size="sm" aria-pressed={playing} onClick={toggle}>
      <AudioLines className="size-4" /> {t("speech.settings.words.recording")}
    </Button>
  );
}
