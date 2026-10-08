// The speech host the app provides (context.ts) from the profile's settings and the recordings API.
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { recordingUrl, uploadRecording, useSettings } from "@/api/hooks.ts";
import type { SpeechHost } from "./context.ts";

export function useSpeechHostValue(): SpeechHost {
  const settings = useSettings().data;
  const client = useQueryClient();
  const keep = settings?.["speech.keepRecordings"];
  const show = settings?.["speech.showText"];
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
    }),
    [keep, show, client],
  );
}
