// LLM endpoints of the API: provider setup, connection test, streamed lesson help.
import { type LessonKey, STREAM_ERROR } from "@sprachanker/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { withAttempt, withCheck, withExample, withScene, withTurns } from "@/api/cache.ts";
import { ApiError, api, apiError, json } from "@/api/client.ts";
import { STATIC } from "@/api/hooks.ts";

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

export type ExplainRequest = Parameters<typeof api.llm.explain.$post>[0]["json"];

/** Reads a streamed text response; `onText` receives the whole text so far. */
/** What a streamed reply is read from: its status, its body, and its JSON when it failed. */
type StreamedResponse = Pick<Response, "ok" | "status" | "body" | "json">;

async function readStream(res: StreamedResponse, onText: (text: string) => void): Promise<string> {
  if (!res.ok || !res.body) throw await apiError(res);
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

/** After an explanation was kept: the run's kept explanations are read again. */
export function useExplanationsKept(runId: string | undefined) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["explanations", runId] });
}

export type SpeakingRequest = Parameters<typeof api.llm.speaking.$post>[0]["json"];
type SpokenChecks = Awaited<ReturnType<typeof fetchSpokenChecks>>;
export type KeptSpokenCheck = SpokenChecks["checks"][number];
const fetchSpokenChecks = (lessonKey: string, runId: string) =>
  json(api.llm.speaking.$get({ query: { lessonKey, runId } }));

/** Checks of answers said aloud kept in a lesson run (05). */
export const useSpokenChecks = (lessonKey: string, runId: string) =>
  useQuery({
    queryKey: ["spoken", runId],
    queryFn: () => fetchSpokenChecks(lessonKey, runId),
  });

/** Checks an answer said aloud; the run's kept checks take it at once. */
export function useCheckSpoken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: SpeakingRequest) => json(api.llm.speaking.$post({ json: request })),
    onSuccess: (check, request) =>
      client.setQueryData(["spoken", request.runId], (old: SpokenChecks | undefined) =>
        withCheck(old, check),
      ),
  });
}

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

export type TutorTurn = NonNullable<ReturnType<typeof useTutorHistory>["data"]>["turns"][number];

/** The lesson's chat as cached: emptied when a new chat opens, a stored pair added at once. */
export function useTutorCache(lessonKey: string) {
  const client = useQueryClient();
  const key = ["tutor", lessonKey];
  return {
    clear: () => client.setQueryData(key, { turns: [] }),
    add(turns: TutorTurn[]) {
      client.setQueryData(key, (old: { turns: TutorTurn[] } | undefined) => withTurns(old, turns));
      // The history lists the chat with its new turns.
      void client.invalidateQueries({ queryKey: ["tutor-chats", lessonKey] });
    },
  };
}

/** The lesson's chats with the tutor, newest first (the current one marked). */
export const useTutorChats = (lessonKey: string) =>
  useQuery({
    queryKey: ["tutor-chats", lessonKey],
    queryFn: () => json(api.llm.tutor.chats.$get({ query: { lessonKey: lessonKey as LessonKey } })),
  });
export type TutorChat = NonNullable<ReturnType<typeof useTutorChats>["data"]>["chats"][number];

/** One of the lesson's chats, turn by turn. */
export const useTutorChat = (lessonKey: string, id: string) =>
  useQuery({
    queryKey: ["tutor-chat", id],
    queryFn: () =>
      json(
        api.llm.tutor.chats[":id"].$get({
          param: { id },
          query: { lessonKey: lessonKey as LessonKey },
        }),
      ),
  });

/** Deletes one of the lesson's chats with its turns (on the learner's confirmation). */
export function useDeleteChat(lessonKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      json(
        api.llm.tutor.chats[":id"].$delete({
          param: { id },
          query: { lessonKey: lessonKey as LessonKey },
        }),
      ),
    onSuccess: () =>
      Promise.all(
        ["tutor", "tutor-chats"].map((key) =>
          client.invalidateQueries({ queryKey: [key, lessonKey] }),
        ),
      ),
  });
}

export function useResetTutor(lessonKey: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => json(api.llm.tutor.reset.$post({ json: { lessonKey } })),
    onSuccess: () => {
      client.setQueryData(["tutor", lessonKey], { turns: [] });
      void client.invalidateQueries({ queryKey: ["tutor-chats", lessonKey] });
    },
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
  | { speaking: SpeakingRequest }
  | { scene: SceneLineRequest }
  | { example: ExampleRequest };

/** The exact request a task would send now (nothing is sent). */
export function fetchPrompt(kind: PromptRequest): Promise<PromptPreview> {
  if ("explain" in kind) return fetchExplainPrompt(kind.explain);
  if ("tutor" in kind) return json(api.llm.tutor.prompt.$post({ json: kind.tutor }));
  if ("writing" in kind) return json(api.llm.writing.prompt.$post({ json: kind.writing }));
  if ("speaking" in kind) return json(api.llm.speaking.prompt.$post({ json: kind.speaking }));
  if ("example" in kind) return json(api.llm.examples.prompt.$post({ json: kind.example }));
  return json(api.llm.scene.prompt.$post({ json: kind.scene }));
}

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
/** While the server checks a text (asked from here or before), asked again until its result is in. */
const WHILE_BUSY = 1500;

export const useWriting = (series: string, lessonKey: string, edition: string) =>
  useQuery({
    queryKey: ["writing", lessonKey, edition],
    queryFn: () => fetchWriting(series, lessonKey, edition),
    refetchInterval: (query) => (query.state.data?.checking ? WHILE_BUSY : false),
  });

/** `onChecked` runs once the check is stored, also when the page that asked is gone meanwhile. */
export function useCheckWriting(onChecked?: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: WritingRequest) => json(api.llm.writing.$post({ json: request })),
    // Shown at once on top of the earlier texts.
    onSuccess: (attempt, request) => {
      client.setQueryData(["writing", request.lessonKey, request.edition], (old: WritingState) =>
        old ? { ...withAttempt(old, attempt), checking: null } : old,
      );
      onChecked?.();
    },
  });
}

type SceneStartRequest = Parameters<typeof api.llm.scene.start.$post>[0]["json"];
export type SceneLineRequest = Parameters<typeof api.llm.scene.turn.$post>[0]["json"];
export type SceneState = Awaited<ReturnType<typeof fetchScenes>>["scenes"][number];
const fetchScenes = (lessonKey: LessonKey) => json(api.llm.scene.$get({ query: { lessonKey } }));

/** The lesson's scenes, newest first: the latest (active or finished), then earlier ones. */
export const useScenes = (lessonKey: LessonKey) =>
  useQuery({
    queryKey: ["scenes", lessonKey],
    queryFn: () => fetchScenes(lessonKey),
    refetchInterval: (query) => (query.state.data?.pending ? WHILE_BUSY : false),
  });

/** Starts a new scene (the open one ends) or sends a line of the open one; `onStarted` runs once a
 *  scene is stored, also when the page that asked is gone meanwhile. */
export function useSceneAction(lessonKey: LessonKey, onStarted?: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: { start: SceneStartRequest } | { turn: SceneLineRequest }) =>
      "start" in action
        ? json(api.llm.scene.start.$post({ json: action.start }))
        : json(api.llm.scene.turn.$post({ json: action.turn })),
    // Shown at once: the scene first; a start ends the one that was open.
    onSuccess: (scene, action) => {
      client.setQueryData(
        ["scenes", lessonKey],
        (old: { scenes: SceneState[]; pending: unknown } | undefined) => ({
          ...withScene(old, scene, "start" in action),
          pending: null,
        }),
      );
      if ("start" in action) onStarted?.();
    },
  });
}

export type ExampleRequest = Parameters<typeof api.llm.examples.$post>[0]["json"];
export type WordExampleShown = Awaited<ReturnType<typeof makeExample>>;
const makeExample = (request: ExampleRequest) => json(api.llm.examples.$post({ json: request }));

/** A card's AI examples, newest first; read only once asked for (`enabled`). */
export const useExamples = (cardId: string, enabled: boolean) =>
  useQuery({
    queryKey: ["examples", cardId],
    enabled,
    queryFn: () => json(api.llm.examples.$get({ query: { cardId } })),
  });

/** A new example of the card's word, on top of the kept ones. */
export function useMakeExample(cardId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (language: string) => makeExample({ cardId, language }),
    onSuccess: (made) =>
      client.setQueryData(
        ["examples", cardId],
        (old: { examples: WordExampleShown[] } | undefined) => withExample(old, made),
      ),
  });
}
