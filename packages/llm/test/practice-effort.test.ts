// A course's practice is made ahead, many calls a lesson: none of its tasks asks a command-line agent
// to think before the reply (owner, 2026-10-18: thinking was over half of what Claude wrote, and the
// texts and their ratings came out alike without it). Each reply carries its own plan: a draft's
// people, beats and facts, the judge's gist of each draft.
import { expect, test } from "bun:test";
import { cliRun } from "../src/cli.ts";
import { type StructuredTask, structuredRequest } from "../src/structured.ts";
import { talkCardTask, talkCuesTask } from "../src/tasks/talk.ts";
import { TEXT_GENRES } from "../src/tasks/text-genres.ts";
import {
  type UnderstandingDraft,
  understandingDraftTask,
  understandingJudgeTask,
  understandingQuestionsTask,
} from "../src/tasks/understanding.ts";
import { writingTaskTask } from "../src/tasks/writing-task.ts";

const RU_DE = { language: "ru", target: "de" } as const;
const lesson = { title: "Begrüßung", goals: [], vocab: [], grammarHtml: [], level: "A2" };
const genre = TEXT_GENRES[0] as (typeof TEXT_GENRES)[number];
const draft: UnderstandingDraft = {
  setting: "Чат",
  title: "Привет",
  situation: "Анна пишет Тому.",
  people: [{ name: "Anna", gender: "f", age: "adult", role: "подруга" }],
  beats: ["a", "b"],
  facts: ["a", "b", "c"],
  text: "Anna: Hallo Tom, wie geht's?",
};

test("the practice's tasks think not before their reply: Claude's thinking budget nothing", () => {
  const tasks: StructuredTask<unknown>[] = [
    understandingDraftTask({ ...RU_DE, lesson, genre, areas: [] }),
    understandingJudgeTask({ ...RU_DE, lesson, genre, drafts: [draft] }),
    understandingQuestionsTask({
      ...RU_DE,
      lesson,
      step: "reading",
      text: { lines: [{ text: "Hallo" }] },
      facts: [],
      count: 5,
    }),
    writingTaskTask({ ...RU_DE, lesson }),
    talkCardTask({ ...RU_DE, lesson }),
    talkCuesTask({
      ...RU_DE,
      lines: [
        { speaker: "A", text: "Hallo" },
        { speaker: "B", text: "Hi" },
      ],
      learner: "B",
    }),
  ];
  for (const task of tasks) {
    const request = { ...structuredRequest(task), model: "sonnet" };
    expect([task.name, request.effort]).toEqual([task.name, "none"]);
    expect(cliRun("claude", request).env?.MAX_THINKING_TOKENS).toBe("0");
  }
});
