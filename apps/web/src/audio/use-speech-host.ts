// The speech host the app provides (context.ts) from the profile's settings, the recordings API and
// recognition.
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  recordingUrl,
  transcribe,
  uploadRecording,
  useSettings,
  useSpeechState,
  warmSpeech,
} from "@/api/hooks.ts";
import type { SpeechHost } from "./context.ts";
import { toWav16k } from "./wav.ts";

/** A warm-up is asked again only after this long (the engine stays warm for ten minutes). */
const WARM_AGAIN_MS = 5 * 60_000;
let warmedAt = 0;

export function useSpeechHostValue(): SpeechHost {
  const settings = useSettings().data;
  const client = useQueryClient();
  const keep = settings?.["speech.keepRecordings"];
  const show = settings?.["speech.showText"];
  const hold = settings?.["speech.pushToTalk"] === "hold";
  const recognition = !!useSpeechState().data?.recognition;
  return useMemo(
    () => ({
      keepRecordings: keep !== false,
      showText: show === "always" ? "always" : "after",
      async save(take) {
        const id = await uploadRecording(take);
        void client.invalidateQueries({ queryKey: ["recordings"] });
        return id;
      },
      src: recordingUrl,
      recognition,
      pushToTalk: hold ? "hold" : "tap",
      transcribe: async (take, lang) => transcribe(await toWav16k(take.blob), lang),
      warm() {
        if (!recognition || Date.now() - warmedAt < WARM_AGAIN_MS) return;
        warmedAt = Date.now();
        void warmSpeech();
      },
    }),
    [keep, show, client, recognition, hold],
  );
}
