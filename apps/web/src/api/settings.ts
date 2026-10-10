// The app and the profile's settings: the server's version, the settings and their change.
import { type LearnerSettingKey, type SettingRead, settingOf } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json, STATIC } from "./client.ts";

/** The server's version (and that it answers). */
export const useAppInfo = () =>
  useQuery({
    queryKey: ["health"],
    meta: STATIC,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => json(api.health.$get()),
  });

export type Settings = Record<string, unknown>;
export const useSettings = () =>
  useQuery({
    queryKey: ["settings"],
    queryFn: () => json(api.settings.$get()) as Promise<Settings>,
  });

/** A preference as the profile has it: set, or its default (schema `SETTING_DEFAULTS`). */
export const useSetting = <K extends LearnerSettingKey>(key: K): SettingRead<K> =>
  settingOf(useSettings().data, key);

/** What the server works out from a setting, read again once the setting is stored: the model in use
 *  (recognition, Qwen3-TTS), the decks' counts and queues (Review's limits). */
const derivedFrom = (key: string): string[][] =>
  key === "speech.model" || key === "speech.recognition"
    ? [["speech"]]
    : key === "speech.qwenModel"
      ? [["qwen-tts"]]
      : key.startsWith("srs.")
        ? [["decks"], ["study"]]
        : [];

export function useSetSetting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      json(api.settings.$put({ json: { key, value } })),
    // Applied at once, so a screen opened right after (e.g. a course in the chosen edition) sees it;
    // a read in flight could bring the old value back, so it is cancelled.
    onMutate: async ({ key, value }) => {
      await client.cancelQueries({ queryKey: ["settings"] });
      const before = client.getQueryData<Settings>(["settings"]);
      client.setQueryData(["settings"], (old: Settings | undefined) => ({ ...old, [key]: value }));
      return { key, had: before && key in before, was: before?.[key] };
    },
    // Not stored: the value goes back to what it was — unless a later change of it is shown by now
    // (a later one stored, or on its way, is the one to keep).
    onError: (_error, { key, value }, saved) => {
      if (!saved) return;
      client.setQueryData(["settings"], (old: Settings | undefined) => {
        if (old?.[key] !== value) return old;
        const next = { ...old };
        if (saved.had) next[saved.key] = saved.was;
        else delete next[saved.key];
        return next;
      });
    },
    // Only this key from the answer: another change still in flight keeps its own value.
    onSuccess: (settings, { key }) => {
      client.setQueryData(["settings"], (old: Settings | undefined) => {
        const next = { ...old };
        if (key in settings) next[key] = settings[key];
        else delete next[key];
        return next;
      });
      for (const queryKey of derivedFrom(key)) void client.invalidateQueries({ queryKey });
    },
  });
}
