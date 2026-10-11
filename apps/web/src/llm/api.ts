// The assistant's tasks in the API (07): explanations, the tutor, writing, spoken answers, scenes, a
// deck's words given examples (and a card's), exam ratings and conversations, and the request each would send (the prompt viewer). Its
// setup — providers, models, LM Studio, the prompts — is setup-api.ts.
import { CHAT_ID_HEADER, type LessonKey, STREAM_ERROR } from "@sprachanker/schema";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useEffect, useRef } from "react";
import { withAttempt, withCheck, withScene, withTurns } from "@/api/cache.ts";
import { ApiError, api, apiError, json } from "@/api/client.ts";

export type ExplainRequest = Parameters<typeof api.llm.explain.$post>[0]["json"];

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

type ExamRatingRequest = Parameters<(typeof api.llm)["exam-rating"]["$post"]>[0]["json"];

/** The ratings of an exam's open answer proposed by the model, kept in the exam run (its page takes
 *  the event). */
export const useProposeRating = () =>
  useMutation({
    mutationFn: (request: ExamRatingRequest) =>
      json(api.llm["exam-rating"].$post({ json: request })),
  });

type ConversationRequest = Parameters<(typeof api.llm)["exam-conversation"]["$post"]>[0]["json"];

/** The next lines of an exam's speaking part (kept in the exam run; its page takes the events). */
export const useConversationTurn = () =>
  useMutation({
    mutationFn: (request: ConversationRequest) =>
      json(api.llm["exam-conversation"].$post({ json: request })),
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

/** Whose chats: a lesson's (its key), or the Tutor section's (`SECTION`). */
export const SECTION = null;
type ChatsOf = string | typeof SECTION;
const chatsQuery = (about: ChatsOf) => (about === SECTION ? {} : { lessonKey: about as LessonKey });

/** The chats with the tutor about a lesson, newest first (the current one marked). */
export const useTutorChats = (lessonKey: string) =>
  useQuery({
    queryKey: ["tutor-chats", lessonKey],
    queryFn: () => json(api.llm.tutor.chats.$get({ query: { lessonKey: lessonKey as LessonKey } })),
  });
export type TutorChat = NonNullable<ReturnType<typeof useTutorChats>["data"]>["chats"][number];

const fetchSectionChats = (offset: number) =>
  json(api.llm.tutor.section.chats.$get({ query: offset ? { offset: String(offset) } : {} }));
export type SectionChats = Awaited<ReturnType<typeof fetchSectionChats>>;

/** The Tutor section's chats by their last message, a page at a time ("Show more": the next), and
 *  whether a new one can begin and the languages it can practise (the first page says); read while
 *  `enabled`. */
export const useSectionChats = (enabled = true) =>
  useInfiniteQuery({
    queryKey: ["tutor-chats", SECTION],
    enabled,
    queryFn: ({ pageParam }) => fetchSectionChats(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last: SectionChats, pages: SectionChats[]) =>
      last.more ? pages.reduce((n, p) => n + p.chats.length, 0) : undefined,
  });

const fetchChat = (about: ChatsOf, id: string) =>
  json(api.llm.tutor.chats[":id"].$get({ param: { id }, query: chatsQuery(about) }));

/** One of the chats about a lesson (or the section's), turn by turn; read once there is an `id` —
 *  only shown from the cache while `fetch` is false (a new chat whose first reply is on its way). */
export const useTutorChat = (about: ChatsOf, id: string | undefined, fetch = true) =>
  useQuery({
    queryKey: ["tutor-chat", id],
    enabled: !!id && fetch,
    queryFn: () => fetchChat(about, id as string),
  });

/** Reads one of the section's chats anew into the cache, the list told of it: false when there is
 *  no such chat (a new chat whose reply was never kept). */
export function useReadSectionChat() {
  const client = useQueryClient();
  return (id: string) =>
    client
      .fetchQuery({
        queryKey: ["tutor-chat", id],
        queryFn: () => fetchChat(SECTION, id),
        staleTime: 0,
      })
      .then(
        () => {
          void client.invalidateQueries({ queryKey: ["tutor-chats", SECTION] });
          return true;
        },
        (error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return false;
          throw error;
        },
      );
}

/** Deletes one of the chats about a lesson (or the section's) with its turns (on the learner's
 *  confirmation). */
export function useDeleteChat(about: ChatsOf) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      json(api.llm.tutor.chats[":id"].$delete({ param: { id }, query: chatsQuery(about) })),
    onSuccess: () =>
      Promise.all(
        ["tutor", "tutor-chats"].map((key) => client.invalidateQueries({ queryKey: [key, about] })),
      ),
  });
}

export type SectionRequest = Parameters<typeof api.llm.tutor.section.$post>[0]["json"];
export type SectionPromptRequest = Omit<SectionRequest, "message"> & { message: string };

/** A message in the Tutor section, its reply streamed. The chat it is in — a new one's named by the
 *  server — goes to `onChat` as soon as the reply begins, before it is read: a reply stopped or broken
 *  off still tells it. */
export async function streamSection(
  request: SectionRequest,
  onText: (text: string) => void,
  signal: AbortSignal,
  onChat: (id: string) => void,
): Promise<string> {
  const res = await api.llm.tutor.section.$post({ json: request }, { init: { signal } });
  const chatId = res.ok ? res.headers.get(CHAT_ID_HEADER) : null;
  if (chatId) onChat(chatId);
  return readStream(res, onText);
}

/** A section's chat as cached: a stored pair added at once, the list told of it. */
export function useSectionCache() {
  const client = useQueryClient();
  return (id: string, turns: TutorTurn[]) => {
    client.setQueryData(["tutor-chat", id], (old: { turns: TutorTurn[] } | undefined) =>
      withTurns(old, turns),
    );
    void client.invalidateQueries({ queryKey: ["tutor-chats", SECTION] });
  };
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

export type PromptPreview = Awaited<ReturnType<typeof fetchExplainPrompt>>;
const fetchExplainPrompt = (request: ExplainRequest) =>
  json(api.llm.explain.prompt.$post({ json: request }));

export type TutorPromptRequest = Omit<TutorRequest, "message"> & { message: string };

/** Which task's request the prompt viewer shows, with its input. */
export type PromptRequest =
  | { explain: ExplainRequest }
  | { tutor: TutorPromptRequest }
  | { section: SectionPromptRequest }
  | { writing: WritingRequest }
  | { speaking: SpeakingRequest }
  | { scene: SceneLineRequest }
  | { deckExamples: { scope: string } }
  | { exam: ExamRatingRequest }
  | { conversation: ConversationRequest };

/** The exact request a task would send now (nothing is sent). */
export function fetchPrompt(kind: PromptRequest): Promise<PromptPreview> {
  if ("explain" in kind) return fetchExplainPrompt(kind.explain);
  if ("tutor" in kind) return json(api.llm.tutor.prompt.$post({ json: kind.tutor }));
  if ("section" in kind) return json(api.llm.tutor.section.prompt.$post({ json: kind.section }));
  if ("writing" in kind) return json(api.llm.writing.prompt.$post({ json: kind.writing }));
  if ("speaking" in kind) return json(api.llm.speaking.prompt.$post({ json: kind.speaking }));
  if ("deckExamples" in kind)
    return json(api.decks.examples.prompt.$post({ json: kind.deckExamples }));
  if ("exam" in kind) return json(api.llm["exam-rating"].prompt.$post({ json: kind.exam }));
  if ("conversation" in kind)
    return json(api.llm["exam-conversation"].prompt.$post({ json: kind.conversation }));
  return json(api.llm.scene.prompt.$post({ json: kind.scene }));
}

/** What the tutor's context gauge measures: a lesson's chat or a section's. */
export type ContextRequest = TutorPromptRequest | SectionPromptRequest;

/** How full the tutor's next request is (refreshed after each turn). */
export const useTutorContext = (request: ContextRequest, turns: number) =>
  useQuery({
    queryKey: [
      "tutor-context",
      "lessonKey" in request ? request.lessonKey : (request.chatId ?? SECTION),
      // What else it is about: a lesson's exercise on screen, a new section chat's language.
      "lessonKey" in request ? request.exerciseKey : request.target,
      request.language,
      turns,
    ],
    queryFn: () =>
      "lessonKey" in request
        ? json(api.llm.tutor.context.$post({ json: request }))
        : json(api.llm.tutor.section.context.$post({ json: request })),
  });

type WritingRequest = Parameters<typeof api.llm.writing.$post>[0]["json"];
type WritingState = Awaited<ReturnType<typeof fetchWriting>>;
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
/** A line of the open Dialogue: as heard (`spoken`, with its take) or typed. */
type SceneLineRequest = Parameters<typeof api.llm.scene.turn.$post>[0]["json"];
export type SceneState = Awaited<ReturnType<typeof fetchScenes>>["scenes"][number];
const fetchScenes = (lessonKey: LessonKey) => json(api.llm.scene.$get({ query: { lessonKey } }));

/** The lesson's Dialogues (scene runs), newest first: the latest (active or finished), then earlier
 *  ones. */
export const useScenes = (lessonKey: LessonKey) =>
  useQuery({
    queryKey: ["scenes", lessonKey],
    queryFn: () => fetchScenes(lessonKey),
    refetchInterval: (query) => (query.state.data?.pending ? WHILE_BUSY : false),
  });

/** What the learner does with the lesson's Dialogue. */
export type SceneAction =
  | { start: SceneStartRequest }
  | { turn: SceneLineRequest }
  | { end: SceneStartRequest }
  | { summary: SceneStartRequest };

/** Starts a new Dialogue (the open one ends), sends a line of the open one, ends it, or asks for its
 *  summary again; `onStarted` runs once one is stored, also when the page that asked is gone
 *  meanwhile. */
export function useSceneAction(lessonKey: LessonKey, onStarted?: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: SceneAction) =>
      "start" in action
        ? json(api.llm.scene.start.$post({ json: action.start }))
        : "turn" in action
          ? json(api.llm.scene.turn.$post({ json: action.turn }))
          : "end" in action
            ? json(api.llm.scene.end.$post({ json: action.end }))
            : json(api.llm.scene.summary.$post({ json: action.summary })),
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

/** Whether a deck's examples job is working (or finishing the words under way once stopped). */
export const writing = (state: DeckExamplesState | undefined) =>
  state?.job?.status === "running" || state?.job?.status === "stopping";

export type DeckExamplesState = InferResponseType<typeof api.decks.examples.$get, 200>;

/** A deck's words given examples (`scope`: `course:<key>` or `deck:<id>`): how many have them, the
 *  job — polled while it runs; when it ends, the cards' examples are read anew. */
export function useDeckExamples(scope: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["deck-examples", scope],
    queryFn: () => json(api.decks.examples.$get({ query: { scope } })),
    refetchInterval: (q) => (writing(q.state.data) ? 2000 : false),
  });
  const going = writing(query.data);
  const before = useRef(going);
  useEffect(() => {
    if (before.current && !going) void client.invalidateQueries({ queryKey: ["card-examples"] });
    before.current = going;
  }, [going, client]);
  return query;
}

/** A deck's examples job started (with this profile's model) or stopped; the state the server
 *  answers with is shown. */
export function useDeckExamplesActions(scope: string) {
  const client = useQueryClient();
  const onSuccess = (state: DeckExamplesState) =>
    client.setQueryData(["deck-examples", scope], state);
  return {
    start: useMutation({
      mutationFn: () => json(api.decks.examples.$post({ json: { scope } })),
      onSuccess,
    }),
    stop: useMutation({
      mutationFn: () => json(api.decks.examples.$delete({ query: { scope } })),
      onSuccess,
    }),
  };
}

/** A card's examples made for its deck, as shown; read once its answer is (`enabled`). */
export const useCardExamples = (cardId: string, enabled = true) =>
  useQuery({
    queryKey: ["card-examples", cardId],
    enabled,
    queryFn: () => json(api.cards[":id"].examples.$get({ param: { id: cardId }, query: {} })),
  });
