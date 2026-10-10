// The assistant's setup in the API (07): the route and providers, a provider's key state and models (the
// connection test), LM Studio, the tasks' system prompts and where the assistant is turned off.
import type { AiPlace } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/api/client.ts";
import { STATIC, useSetting } from "@/api/hooks.ts";

export type LlmState = Awaited<ReturnType<typeof fetchState>>;
export type ProviderId = LlmState["providers"][number]["id"];

const fetchState = () => json(api.llm.$get());

export const useLlm = () => useQuery({ queryKey: ["llm"], queryFn: fetchState });

/** Whether the assistant works in a place: a model set up and the place not turned off (Settings →
 *  Prompts); undefined while that is read. */
export function useAiIn(place: AiPlace): boolean | undefined {
  const llm = useLlm();
  const off = useSetting("llm.offIn");
  if (llm.isPending) return undefined;
  return !!llm.data?.model && !off.includes(place);
}

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

/** The state of a provider's key where it tells it (OpenRouter: free tier, credits, limits). */
export const useKeyState = (provider: ProviderId, enabled: boolean) =>
  useQuery({
    queryKey: ["llm-key", provider],
    enabled,
    retry: false,
    queryFn: () => json(api.llm.key.$get({ query: { provider } })),
  });

/** Model list of a provider; fetched on demand (it is also the connection test). */
export const useModels = (provider: ProviderId | null) =>
  useQuery({
    queryKey: ["llm-models", provider],
    enabled: false,
    retry: false,
    queryFn: () => json(api.llm.models.$get({ query: { provider: provider as ProviderId } })),
  });

/** A model as the server lists it. */
export type ListedModel = NonNullable<ReturnType<typeof useModels>["data"]>["models"][number];

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
      "start" in action
        ? json(api.llm.lmstudio.start.$post())
        : json(api.llm.lmstudio.download.$post({ json: { model: action.download } })),
    onSuccess: (status) => client.setQueryData(["lmstudio"], status),
  });
}

/** Settings key: show "Prompt" buttons next to AI answers. */
export const DEBUG_PROMPTS = "llm.debugPrompts";

/** The tasks' system prompts (standing or the learner's own) and context budgets, for the settings;
 *  none while no course is installed. */
const fetchTaskPrompts = (language: string, target: string) =>
  json(api.llm.prompts.$get({ query: { language, target } }));
export const useTaskPrompts = (language: string, target: string | undefined) =>
  useQuery({
    queryKey: ["llm-prompts", language, target],
    meta: STATIC,
    enabled: !!target,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => fetchTaskPrompts(language, target as string),
  });

/** Saves the learner's own system prompt of a task ({language}, {target}); null restores the standing one. */
export function useSetPrompt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ task, template }: { task: PromptTaskId; template: string | null }) =>
      json(api.llm.prompts[":task"].$put({ param: { task }, json: { template } })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["llm-prompts"] }),
  });
}
/** The tasks with a system prompt the learner may change (the server's list). */
export type PromptTaskId = keyof Awaited<ReturnType<typeof fetchTaskPrompts>>;
