// An exam's speaking part held with the assistant (owner's choice
// B, 2026-10-10): the configured model plays the examiner and the partner, the learner answers aloud.
// Every line is an `llm_turn` on the question in the exam run — the learner's as `user`, the model's
// as `assistant` with its `speaker` — so the run's page shows the conversation; the learner's lines
// are the answer, rated afterwards by the part's criteria with the conversation around them. The
// part ends when the examiner closes it or the learner ends it (an empty line of theirs, `done`);
// ended with nothing said, practice may begin it again (a mock exam's stays unanswered) with the
// examiner's opening as before — the same card, the same topic; the model is not asked anew — and the
// part is its latest conversation (engine `latestConversation`). One line answered at a time per part.
import { conversationAnswer, conversationEnded, latestConversation } from "@sprachanker/engine";
import {
  conversationOf,
  type ExamConversationInput,
  examConversationTask,
  structuredRequest,
} from "@sprachanker/llm";
import { examLang, type LlmTurnPayload, type TypedEvent } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { Exams } from "./exams.ts";
import { createInFlight } from "./in-flight.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import { payloadOf, type RunStore } from "./run-store.ts";

export interface ConversationRequest {
  runId: string;
  itemKey: string;
  /** The learner's line, as heard or typed; none to open the part. */
  text?: string;
  /** The learner ends the part (once ended, nothing more is kept). */
  end?: boolean;
  language: string;
}

/** A conversation's opening: the examiner's and the partner's lines before the learner's first one,
 *  none that closed it. */
const openingOf = (lines: LlmTurnPayload[]) => {
  const first = lines.findIndex((l) => l.role === "user" || l.done);
  return (first < 0 ? lines : lines.slice(0, first)).filter((l) => l.text.trim());
};

export function createExamConversation(deps: { llm: Llm; store: RunStore; exams: Exams }) {
  const { llm, store } = deps;
  const busy = createInFlight<true>("exam_conversation_busy");

  /** The part's lines so far, every conversation's, oldest first (the learner's ending among them). */
  const linesOf = (runId: string, itemKey: string) =>
    store
      .events(runId, ["llm_turn"])
      .filter((e) => e.itemKey === itemKey)
      .map((e) => payloadOf<LlmTurnPayload>(e));

  async function input(request: ConversationRequest) {
    const { run, exam, locale, item, section } = await deps.exams.speakingPart(
      request.runId,
      request.itemKey,
    );
    const all = linesOf(request.runId, request.itemKey);
    if (conversationEnded(all)) {
      // Ended with nothing said: practice opens it again; otherwise nothing more is said.
      const again =
        run.plan.mode === "practice" && !request.text?.trim() && !conversationAnswer(all);
      if (!again) throw new ServiceError("exam_part_done", 409);
    }
    // The conversation going on (none when it is opened again: the examiner's opening of the one
    // before, until the learner's first line or the examiner's close).
    const said = conversationEnded(all) ? [] : latestConversation(all);
    const opening = conversationEnded(all) ? openingOf(latestConversation(all)) : [];
    // The examiner opens the part; after that every call answers a line of the learner's.
    if (!said.length === !!request.text?.trim()) throw new ServiceError("invalid_request");
    const sectionLocale = section ? locale?.sections[section.key] : undefined;
    const target = examLang(run.edition);
    const history = conversationOf(said);
    if (request.text) history.push({ speaker: "learner", text: request.text.trim() });
    const task: ExamConversationInput = {
      language: request.language,
      target,
      rules: llm.rulesFor("conversation", request.language, target),
      exam: locale?.title ?? exam.key,
      part: sectionLocale?.title ?? section?.key ?? item.key,
      task: [
        sectionLocale?.instructions ?? "",
        item.prompt ?? "",
        section?.text ?? "",
        ...(section?.letters ?? []).map((l) => `Karte ${l.letter}: ${l.text ?? ""}`),
      ],
      ...(item.partner && { partner: item.partner }),
      history,
    };
    return { task, opening };
  }

  /** The learner ends the part: an empty line of theirs closing it, kept once (ended already:
   *  nothing more). */
  async function end(request: ConversationRequest) {
    await deps.exams.speakingPart(request.runId, request.itemKey);
    if (conversationEnded(linesOf(request.runId, request.itemKey)))
      return { events: [], done: true };
    const events = store.append(request.runId, [
      {
        type: "llm_turn" as const,
        itemKey: request.itemKey,
        payload: { role: "user" as const, text: "", done: true },
      },
    ]);
    return { events, done: true };
  }

  return {
    /** The examiner's and the partner's next lines (after the learner's, if given), kept in the run;
     *  the events kept, for the run's page. */
    turn(request: ConversationRequest): Promise<{ events: TypedEvent[]; done: boolean }> {
      return busy.run(`${request.runId}|${request.itemKey}`, true, async () => {
        if (request.end) return end(request);
        const { task, opening } = await input(request);
        if (opening.length) {
          const events = store.append(
            request.runId,
            opening.map(({ done: _, ...payload }) => ({
              type: "llm_turn" as const,
              itemKey: request.itemKey,
              payload,
            })),
          );
          return { events, done: false };
        }
        const { result, model, latencyMs } = await llm.structured(examConversationTask(task));
        const lines: LlmTurnPayload[] = [
          ...(request.text ? [{ role: "user" as const, text: request.text.trim() }] : []),
          ...result.lines.map((line, i) => ({
            role: "assistant" as const,
            text: line.text.trim(),
            speaker: line.speaker,
            model,
            latencyMs,
            ...(result.done && i === result.lines.length - 1 && { done: true }),
          })),
        ];
        const events = store.append(
          request.runId,
          lines.map((payload) => ({
            type: "llm_turn" as const,
            itemKey: request.itemKey,
            payload,
          })),
        );
        return { events, done: result.done };
      });
    },

    /** The request it would send, without sending it. */
    async prompt(request: ConversationRequest): Promise<PromptPreview> {
      return llm.preview(structuredRequest(examConversationTask((await input(request)).task)));
    },
  };
}
export type ExamConversation = ReturnType<typeof createExamConversation>;
