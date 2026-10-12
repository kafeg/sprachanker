import { expect, test } from "bun:test";
import {
  conversationAnswer,
  conversationEnded,
  latestConversation,
} from "../src/exam/conversation.ts";

const examiner = (text: string, done?: boolean) => ({
  role: "assistant" as const,
  text,
  ...(done && { done }),
});
const learner = (text: string, done?: boolean) => ({
  role: "user" as const,
  text,
  ...(done && { done }),
});

test("a speaking part's latest conversation, whether it ended, and the learner's lines as its answer", () => {
  const first = [examiner("Guten Tag!"), learner("", true)];
  // Ended with nothing said.
  expect(latestConversation(first)).toEqual(first);
  expect(conversationEnded(first)).toBe(true);
  expect(conversationAnswer(first)).toBe("");
  // Begun again: the new conversation alone, going on.
  const again = [...first, examiner("Noch einmal."), learner("Ich heiße Anna."), learner("  ")];
  expect(latestConversation(again)).toEqual(again.slice(2));
  expect(conversationEnded(again)).toBe(false);
  expect(conversationAnswer(latestConversation(again))).toBe("Ich heiße Anna.");
  // Closed by the examiner: that conversation, ended.
  const closed = [...again, learner("Und Sie?"), examiner("Danke.", true)];
  expect(latestConversation(closed)).toEqual(closed.slice(2));
  expect(conversationEnded(closed)).toBe(true);
  expect(conversationAnswer(latestConversation(closed))).toBe("Ich heiße Anna.\nUnd Sie?");
  expect(latestConversation([])).toEqual([]);
});
