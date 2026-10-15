// Speech on the server: recognition and its models, Piper's voices, Qwen3-TTS (with the voice for
// words: the recordings it can be taken from, one sent), a text said, a recording heard.
import type { Lang } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiError, json, sendBinary } from "./client.ts";

/** What the server downloads for an engine (models, voices): its state, polled while a download runs,
 *  and the download and removal of one, the state read again after each. */
function downloadable<S>(
  key: string,
  get: () => Promise<S>,
  items: (state: S) => ReadonlyArray<{ downloaded?: number }>,
  change: { download(id: string): Promise<unknown>; remove(id: string): Promise<unknown> },
) {
  const useQueryState = (enabled = true) =>
    useQuery({
      queryKey: [key],
      queryFn: get,
      enabled,
      refetchInterval: (q) =>
        q.state.data && items(q.state.data).some((m) => m.downloaded !== undefined) ? 1000 : false,
    });
  function useActions() {
    const client = useQueryClient();
    const onSuccess = () => client.invalidateQueries({ queryKey: [key] });
    return {
      download: useMutation({ mutationFn: change.download, onSuccess }),
      remove: useMutation({ mutationFn: change.remove, onSuccess }),
    };
  }
  return [useQueryState, useActions] as const;
}

/** Recognition: the engine, its models, the profile's. */
export const [useSpeechState, useSpeechModels] = downloadable(
  "speech",
  () => json(api.speech.$get()),
  (s) => s.models,
  {
    download: (id) => json(api.speech.models[":id"].$post({ param: { id } })),
    remove: (id) => json(api.speech.models[":id"].$delete({ param: { id } })),
  },
);

/** Piper's voices on the server: the engine (built or not), each voice, each language's automatic
 *  one. */
export const [usePiperVoices] = downloadable(
  "piper-voices",
  () => json(api.speech.voices.$get()),
  (s) => s.voices,
  {
    download: (id) => json(api.speech.voices[":id"].$post({ param: { id } })),
    remove: (id) => json(api.speech.voices[":id"].$delete({ param: { id } })),
  },
);

/** Qwen3-TTS on the server: the engine (built or not), its models — the Base model for words among
 *  them —, the languages it speaks, its speakers, each language's voice for words. */
const getQwen = () => json(api.speech.qwen.$get());
export type QwenState = Awaited<ReturnType<typeof getQwen>>;
export const [useQwenTts, useQwenModelActions] = downloadable(
  "qwen-tts",
  getQwen,
  (s) => [...s.models, s.wordModel],
  {
    download: (id) => json(api.speech.qwen.models[":id"].$post({ param: { id } })),
    remove: (id) => json(api.speech.qwen.models[":id"].$delete({ param: { id } })),
  },
);

/** A course's recording the voice for words of a language can be taken from, with what it says and
 *  where it is met (the voice taken: none of that). */
export type WordCandidate = {
  series: string;
  path: string;
  text: string;
  course?: string;
  lesson?: number;
};

/** The courses' recordings the voice for words of `lang` can be taken from, in the server's order. */
export const useWordCandidates = (lang: string, enabled = true) =>
  useQuery({
    queryKey: ["word-candidates", lang],
    queryFn: async () =>
      (await json(api.speech.words[":lang"].candidates.$get({ param: { lang: lang as Lang } })))
        .candidates,
    enabled,
  });

/** A course's recording taken as the voice for words of `lang` (sent as 24 kHz WAV); Qwen3-TTS's
 *  state after. */
export const sendWordVoice = (
  lang: string,
  recording: WordCandidate,
  wav: Uint8Array<ArrayBuffer>,
) =>
  sendBinary<QwenState>(
    `/api/speech/words/${lang}?${new URLSearchParams({ series: recording.series, path: recording.path })}`,
    wav,
    "audio/wav",
  );

/** Starts Qwen3-TTS ahead of reading (loading its model takes seconds). */
export const warmQwen = () => api.speech.qwen.warm.$post().catch(() => {});

/** A text said by the server's voice for its language, as a WAV (the profile's voice and speed; a
 *  word or phrase, `use: "words"`: the voice for words where there is one). */
export async function sayOnServer(
  text: string,
  lang: string,
  options: { voice?: string; use?: "words"; signal?: AbortSignal } = {},
): Promise<Blob> {
  const json = {
    text,
    lang,
    ...(options.voice && { voice: options.voice }),
    ...(options.use && { use: options.use }),
  };
  const res = await api.speech.say.$post({ json }, { init: { signal: options.signal } });
  if (!res.ok) throw await apiError(res);
  return res.blob();
}

/** What was said in a 16 kHz WAV, in a language given (a binary body, not through the RPC client);
 *  empty when nothing was heard. `expected`: the lines to say, telling one said from what the
 *  recogniser makes of silence (never heard with) — short ones only: what it makes up is short. */
export async function transcribe(
  wav: Uint8Array<ArrayBuffer>,
  lang: string,
  expected: readonly string[] = [],
): Promise<string> {
  const query = new URLSearchParams({ lang });
  const short = expected.filter((line) => line.length <= 100).slice(0, 10);
  if (short.length) query.set("expect", short.join("\n"));
  return (await sendBinary<{ text: string }>(`/api/speech/transcribe?${query}`, wav, "audio/wav"))
    .text;
}

/** Starts the recogniser ahead of a recording. */
export const warmSpeech = () => api.speech.warm.$post().catch(() => {});
