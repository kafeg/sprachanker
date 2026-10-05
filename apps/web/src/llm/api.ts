// LLM endpoints of the API: provider setup, connection test, streamed lesson help.
import type { LessonKey } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, json } from "@/api/client.ts";

export type LlmState = Awaited<ReturnType<typeof fetchState>>;
export type ProviderId = LlmState["providers"][number]["id"];

const fetchState = () => json(api.llm.$get());

export const useLlm = () => useQuery({ queryKey: ["llm"], queryFn: fetchState });

export function useSetRoute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (route: { provider: ProviderId | null; model: string | null }) =>
      json(api.llm.route.$put({ json: route })),
    onSuccess: (state) => client.setQueryData(["llm"], state),
  });
}

export function useSetProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...change
    }: {
      id: ProviderId;
      baseUrl?: string | null;
      apiKey?: string | null;
    }) => json(api.llm.providers[":id"].$put({ param: { id }, json: change })),
    onSuccess: (state) => client.setQueryData(["llm"], state as LlmState),
  });
}

/** Model list of a provider; fetched on demand (it is also the connection test). */
export const useModels = (provider: ProviderId | null) =>
  useQuery({
    queryKey: ["llm-models", provider],
    enabled: false,
    retry: false,
    queryFn: async () => {
      const res = await api.llm.models.$get({ query: { provider: provider as ProviderId } });
      const body = await res.json();
      if ("error" in body) throw new ApiError(body.error);
      return body;
    },
  });

export type ExplainRequest = Parameters<typeof api.llm.explain.$post>[0]["json"];

/** Reads a streamed text response; `onText` receives the whole text so far. */
async function readStream(res: Response, onText: (text: string) => void): Promise<string> {
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += value;
    onText(text);
  }
}

export const streamExplain = async (
  request: ExplainRequest,
  onText: (text: string) => void,
  signal: AbortSignal,
) => readStream(await api.llm.explain.$post({ json: request }, { init: { signal } }), onText);

export type TutorRequest = Parameters<typeof api.llm.tutor.$post>[0]["json"];

export const useTutorHistory = (lessonKey: string) =>
  useQuery({
    queryKey: ["tutor", lessonKey],
    queryFn: () => json(api.llm.tutor.$get({ query: { lessonKey } })),
  });

export const streamTutor = async (
  request: TutorRequest,
  onText: (text: string) => void,
  signal: AbortSignal,
) => readStream(await api.llm.tutor.$post({ json: request }, { init: { signal } }), onText);

export function useResetTutor(lessonKey: LessonKey) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => json(api.llm.tutor.reset.$post({ json: { lessonKey } })),
    onSuccess: () => client.setQueryData(["tutor", lessonKey], { turns: [] }),
  });
}

export type LocalStatus = Awaited<ReturnType<typeof fetchLocal>>;
const fetchLocal = () => json(api.llm.local.$get());

/** The built-in model: catalog and download state; polled while something is in progress. */
export const useLocalModels = (enabled: boolean) =>
  useQuery({
    queryKey: ["llm-local"],
    enabled,
    queryFn: fetchLocal,
    refetchInterval: (query) => {
      const data = query.state.data;
      const busy =
        data?.models.some((m) => m.state === "downloading") || data?.running?.state === "starting";
      return busy ? 1000 : 10_000;
    },
  });

export function useLocalAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "download" | "cancel" | "remove" }) =>
      json(
        action === "remove"
          ? api.llm.local[":id"].$delete({ param: { id } })
          : api.llm.local[":id"][action].$post({ param: { id } }),
      ),
    onSuccess: (status) => client.setQueryData(["llm-local"], status),
  });
}
