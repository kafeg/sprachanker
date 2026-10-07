// LLM endpoints of the API: provider setup, connection test, streamed lesson help.
import { type LessonKey, STREAM_ERROR } from "@sprachanker/schema";
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
    queryFn: () => json(api.llm.models.$get({ query: { provider: provider as ProviderId } })),
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
    if (!done) text += value;
    // The reply broke off: the server says why after the mark (the part shown stays).
    const broken = text.indexOf(STREAM_ERROR);
    if (broken < 0) {
      if (done) return text;
      onText(text);
    } else if (done) {
      onText(text.slice(0, broken));
      let error = "llm_bad_response";
      try {
        error = (JSON.parse(text.slice(broken + 1)) as { error?: string }).error ?? error;
      } catch {}
      throw new ApiError(error);
    }
  }
}

export const streamExplain = async (
  request: ExplainRequest,
  onText: (text: string) => void,
  signal: AbortSignal,
) => readStream(await api.llm.explain.$post({ json: request }, { init: { signal } }), onText);

/** Explanations kept in a lesson run (05): the newest one of an item's attempt is shown. */
export const useExplanations = (lessonKey: string, runId: string | undefined) =>
  useQuery({
    queryKey: ["explanations", runId],
    queryFn: () =>
      json(api.llm.explanations.$get({ query: { lessonKey, runId: runId as string } })),
    enabled: !!runId,
  });

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

export function useResetTutor(lessonKey: string) {
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
      "start" in action
        ? json(api.llm.lmstudio.start.$post())
        : json(api.llm.lmstudio.download.$post({ json: { model: action.download } })),
    onSuccess: (status) => client.setQueryData(["lmstudio"], status),
  });
}

/** Settings key: show "Prompt" buttons next to AI answers. */
export const DEBUG_PROMPTS = "llm.debugPrompts";

export type PromptPreview = Awaited<ReturnType<typeof fetchExplainPrompt>>;
const fetchExplainPrompt = (request: ExplainRequest) =>
  json(api.llm.explain.prompt.$post({ json: request }));

export type TutorPromptRequest = Omit<TutorRequest, "message"> & { message: string };

/** Which task's request the prompt viewer shows, with its input. */
export type PromptRequest =
  | { explain: ExplainRequest }
  | { tutor: TutorPromptRequest }
  | { writing: WritingRequest }
  | { scene: SceneLineRequest };

/** The exact request a task would send now (nothing is sent). */
export function fetchPrompt(kind: PromptRequest): Promise<PromptPreview> {
  if ("explain" in kind) return fetchExplainPrompt(kind.explain);
  if ("tutor" in kind) return json(api.llm.tutor.prompt.$post({ json: kind.tutor }));
  if ("writing" in kind) return json(api.llm.writing.prompt.$post({ json: kind.writing }));
  return json(api.llm.scene.prompt.$post({ json: kind.scene }));
}

/** The tasks' system prompts (standing or the learner's own) and context budgets, for the settings;
 *  none while no course is installed. */
const fetchTaskPrompts = (language: string, target: string) =>
  json(api.llm.prompts.$get({ query: { language, target } }));
export const useTaskPrompts = (language: string, target: string | undefined) =>
  useQuery({
    queryKey: ["llm-prompts", language, target],
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

/** How full the tutor's next request is (refreshed after each turn). */
export const useTutorContext = (request: TutorPromptRequest, turns: number) =>
  useQuery({
    queryKey: ["tutor-context", request.lessonKey, request.exerciseKey, request.language, turns],
    queryFn: () => json(api.llm.tutor.context.$post({ json: request })),
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
    mutationFn: (request: WritingRequest) => json(api.llm.writing.$post({ json: request })),
    onSuccess: (_, request) =>
      client.invalidateQueries({ queryKey: ["writing", request.lessonKey, request.edition] }),
  });
}

type SceneStartRequest = Parameters<typeof api.llm.scene.start.$post>[0]["json"];
export type SceneLineRequest = Parameters<typeof api.llm.scene.turn.$post>[0]["json"];
export type SceneState = Awaited<ReturnType<typeof fetchScenes>>["scenes"][number];
const fetchScenes = (lessonKey: LessonKey) => json(api.llm.scene.$get({ query: { lessonKey } }));

/** The lesson's scenes, newest first: the latest (active or finished), then earlier ones. */
export const useScenes = (lessonKey: LessonKey) =>
  useQuery({ queryKey: ["scenes", lessonKey], queryFn: () => fetchScenes(lessonKey) });

/** Starts a new scene (the open one ends) or sends a line of the open one. */
export function useSceneAction(lessonKey: LessonKey) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: { start: SceneStartRequest } | { turn: SceneLineRequest }) =>
      "start" in action
        ? json(api.llm.scene.start.$post({ json: action.start }))
        : json(api.llm.scene.turn.$post({ json: action.turn })),
    // Shown at once: the scene first; a start ends the one that was open.
    onSuccess: (scene, action) =>
      client.setQueryData(["scenes", lessonKey], (old: { scenes: SceneState[] } | undefined) => ({
        scenes: [
          scene,
          ...(old?.scenes ?? [])
            .filter((s) => s.id !== scene.id)
            .map((s) => ("start" in action ? { ...s, done: true } : s)),
        ],
      })),
  });
}
