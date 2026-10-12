// A speaking part held live before scripts (runs kept from then): its lines are the `llm_turn`s on its
// question, a conversation ending on a line marked `done`; the part is the latest conversation, the
// learner's own lines in it its answer. Read when such an answer is rated.
import type { LlmTurnPayload } from "@sprachanker/schema";

type Turn = Pick<LlmTurnPayload, "role" | "text" | "done">;

/** The part's latest conversation: the lines since the one before it ended (going on, or ended —
 *  its last line `done`). */
export function latestConversation<T extends Turn>(turns: T[]): T[] {
  const before = turns.slice(0, -1).findLastIndex((t) => t.done);
  return turns.slice(before + 1);
}

/** A conversation's answer: the learner's own lines, one a line ("" when they said nothing). */
export const conversationAnswer = (turns: Turn[]) =>
  turns
    .filter((t) => t.role === "user" && t.text.trim())
    .map((t) => t.text)
    .join("\n");
