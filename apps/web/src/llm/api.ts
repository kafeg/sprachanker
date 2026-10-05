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

export type LmStudioStatus = Awaited<ReturnType<typeof fetchLmStudio>>;
const fetchLmStudio = () => json(api.llm.lmstudio.$get());

/** LM Studio's state; polled faster while it downloads something. */
export const useLmStudio = () =>
  useQuery({
    queryKey: ["lmstudio"],
    queryFn: fetchLmStudio,
    refetchInterval: (query) =>
      query.state.data?.suggestions.some((m) => m.download?.status === "downloading")
        ? 2000
        : 10_000,
  });

export type SuggestedModel = LmStudioStatus["suggestions"][number]["key"];

export function useLmStudioAction() {
  const client = useQueryClient();
  return useMutation({
    // Error responses (409/502) become an ApiError in json(); success is the new status.
    mutationFn: (action: { start: true } | { download: SuggestedModel }) =>
      json<LmStudioStatus>(
        ("start" in action
          ? api.llm.lmstudio.start.$post()
          : api.llm.lmstudio.download.$post({ json: { model: action.download } })) as never,
      ),
    onSuccess: (status) => client.setQueryData(["lmstudio"], status),
  });
}
