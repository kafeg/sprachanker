// The speech host the app provides (context.ts) from the profile's settings, the recordings API and
// recognition.
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { decodeTime } from "ulid";
import { recordingUrl, uploadRecording, useRecordingStats } from "@/api/recordings.ts";
import { useSetting } from "@/api/settings.ts";
import { transcribe, useSpeechState, warmSpeech } from "@/api/speech.ts";
import type { SpeechHost } from "./context.ts";
import { toWav16k } from "./wav.ts";

/** A warm-up of the same model is asked again only after this long (the engine stays warm for ten
 *  minutes); another model is warmed at once. */
const WARM_AGAIN_MS = 5 * 60_000;
let warmed = { model: "", at: 0 };

export function useSpeechHostValue(): SpeechHost {
  const client = useQueryClient();
  const recognition = !!useSpeechState().data?.recognition;
  const model = useSetting("speech.model") ?? "";
  // Recordings are made in time order: one older than the oldest kept is gone.
  const oldest = useRecordingStats().data?.oldest;
  return useMemo(
    () => ({
      async save(take) {
        const id = await uploadRecording(take);
        void client.invalidateQueries({ queryKey: ["recordings"] });
        return id;
      },
      src: recordingUrl,
      kept: (id) => oldest === undefined || (oldest !== null && decodeTime(id) >= oldest),
      recognition,
      transcribe: async (take, lang) => transcribe(await toWav16k(take.blob), lang),
      warm() {
        if (!recognition) return;
        if (warmed.model === model && Date.now() - warmed.at < WARM_AGAIN_MS) return;
        warmed = { model, at: Date.now() };
        void warmSpeech();
      },
    }),
    [client, recognition, model, oldest],
  );
}
