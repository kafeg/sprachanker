// A speaking part held as a conversation (04, Exams; 07, `exam_conversation`): its lines are the
// `llm_turn`s on its question, a conversation ending on a line marked `done` (the examiner's closing
// line, or the learner's empty one). One ended with nothing said may be begun again in practice, so
// the part is the latest conversation; the learner's own lines in it are the part's answer.
import type { LlmTurnPayload } from "@sprachanker/schema";

type Turn = Pick<LlmTurnPayload, "role" | "text" | "done">;

/** The part's latest conversation: the lines since the one before it ended (going on, or ended —
 *  its last line `done`). */
export function latestConversation<T extends Turn>(turns: T[]): T[] {
  const before = turns.slice(0, -1).findLastIndex((t) => t.done);
  return turns.slice(before + 1);
}

/** Whether the part's latest conversation has ended. */
export const conversationEnded = (turns: Turn[]) => !!turns.at(-1)?.done;

/** A conversation's answer: the learner's own lines, one a line ("" when they said nothing). */
export const conversationAnswer = (turns: Turn[]) =>
  turns
    .filter((t) => t.role === "user" && t.text.trim())
    .map((t) => t.text)
    .join("\n");
