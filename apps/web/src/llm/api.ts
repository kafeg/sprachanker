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

/** Settings key: show "Prompt" buttons next to AI answers. */
export const DEBUG_PROMPTS = "llm.debugPrompts";

export type PromptPreview = Awaited<ReturnType<typeof fetchExplainPrompt>>;
const fetchExplainPrompt = (request: ExplainRequest) =>
  json(api.llm.explain.prompt.$post({ json: request }) as never) as Promise<{
    provider: string;
    model: string;
    url: string;
    body: {
      model: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      [field: string]: unknown;
    };
  }>;

export type TutorPromptRequest = Omit<TutorRequest, "message"> & { message: string };

/** The exact request a task would send now (nothing is sent). */
export const fetchPrompt = (
  kind: { explain: ExplainRequest } | { tutor: TutorPromptRequest } | { writing: WritingRequest },
): Promise<PromptPreview> =>
  "explain" in kind
    ? fetchExplainPrompt(kind.explain)
    : (json(
        ("tutor" in kind
          ? api.llm.tutor.prompt.$post({ json: kind.tutor })
          : api.llm.writing.prompt.$post({ json: kind.writing })) as never,
      ) as Promise<PromptPreview>);

/** The tasks' system prompts and context budgets, for the settings. */
export const useTaskPrompts = (language: string, target: string) =>
  useQuery({
    queryKey: ["llm-prompts", language, target],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => json(api.llm.prompts.$get({ query: { language, target } })),
  });

/** How full the tutor's next request is (refreshed after each turn). */
export const useTutorContext = (request: TutorPromptRequest, turns: number) =>
  useQuery({
    queryKey: ["tutor-context", request.lessonKey, request.exerciseKey, request.language, turns],
    queryFn: () =>
      json(api.llm.tutor.context.$post({ json: request }) as never) as Promise<{
        tokens: number;
        window: number | null;
        reply: number;
        kept: number;
        total: number;
      }>,
  });

export type WritingRequest = Parameters<typeof api.llm.writing.$post>[0]["json"];
export type WritingState = Awaited<ReturnType<typeof fetchWriting>>;
export type WritingAttempt = WritingState["attempts"][number];
const fetchWriting = (series: string, lessonKey: string, edition: string) =>
  json(api.llm.writing.$get({ query: { series, lessonKey, edition } }));

/** The lesson's writing task and earlier attempts. */
export const useWriting = (series: string, lessonKey: string, edition: string) =>
  useQuery({
    queryKey: ["writing", lessonKey, edition],
    queryFn: () => fetchWriting(series, lessonKey, edition),
  });

export function useCheckWriting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: WritingRequest) =>
      json(api.llm.writing.$post({ json: request }) as never) as Promise<WritingAttempt>,
    onSuccess: (_, request) =>
      client.invalidateQueries({ queryKey: ["writing", request.lessonKey, request.edition] }),
  });
}
