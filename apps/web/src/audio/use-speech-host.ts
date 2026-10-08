// The speech host the app provides (context.ts) from the profile's settings, the recordings API and
// recognition.
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  recordingUrl,
  transcribe,
  uploadRecording,
  useSetting,
  useSpeechState,
  warmSpeech,
} from "@/api/hooks.ts";
import type { SpeechHost } from "./context.ts";
import { toWav16k } from "./wav.ts";

/** A warm-up of the same model is asked again only after this long (the engine stays warm for ten
 *  minutes); another model is warmed at once. */
const WARM_AGAIN_MS = 5 * 60_000;
let warmed = { model: "", at: 0 };

export function useSpeechHostValue(): SpeechHost {
  const client = useQueryClient();
  const keep = useSetting("speech.keepRecordings");
  const show = useSetting("speech.showText");
  const pushToTalk = useSetting("speech.pushToTalk");
  const recognition = !!useSpeechState().data?.recognition;
  const model = useSetting("speech.model") ?? "";
  return useMemo(
    () => ({
      keepRecordings: keep,
      showText: show,
      async save(take) {
        const id = await uploadRecording(take);
        void client.invalidateQueries({ queryKey: ["recordings"] });
        return id;
      },
      src: recordingUrl,
      recognition,
      pushToTalk,
      transcribe: async (take, lang) => transcribe(await toWav16k(take.blob), lang),
      warm() {
        if (!recognition) return;
        if (warmed.model === model && Date.now() - warmed.at < WARM_AGAIN_MS) return;
        warmed = { model, at: Date.now() };
        void warmSpeech();
      },
    }),
    [keep, show, client, recognition, pushToTalk, model],
  );
}
