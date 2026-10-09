// The run-throughs' store checks catch a store broken on purpose (10, "Run-throughs"): a lesson walked
// through and stored as it should be passes; each thing taken away or changed is named.
import { expect, test } from "bun:test";
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { type EventRow, lessonProblems, type Stored } from "./store.ts";

const KEY = "x.y/c/00-01";
const ITEM = `${KEY}/ex-01#1`;
const lesson = {
  key: KEY,
  vocab: [{ key: `${KEY}/v-hallo`, lexeme: "lex:de:hallo:word" }],
  pages: [
    {
      exercise: {
        key: `${KEY}/ex-01`,
        type: "single_choice",
        ruleIds: [],
        items: [
          {
            key: ITEM,
            options: [
              { id: "a", text: "ja" },
              { id: "b", text: "nein" },
            ],
            answer: { optionIds: ["a"] },
          },
        ],
      },
    },
  ],
} as unknown as Lesson;
const locale = {
  tabs: { grammar: [{ bodyHtml: "<p>x</p>" }], culture: [] },
} as unknown as LocaleLesson;

const event = (type: string, payload: unknown, extra: Partial<EventRow> = {}): EventRow => ({
  run_id: "R",
  type,
  item_key: null,
  card_id: null,
  payload_json: JSON.stringify(payload),
  ...extra,
});

const whole = (): Stored => ({
  runs: [
    { id: "R", kind: "lesson", context_key: KEY, status: "finished", end_reason: "completed" },
  ],
  events: [
    event("step_done", { step: "words" }),
    event("step_done", { step: "grammar:0" }),
    event("page_shown", { pageIndex: 0 }),
    event(
      "answered",
      { answer: { optionId: "b" }, attempt: 1, ms: 1, outcome: { result: "wrong", score: 0 } },
      { item_key: ITEM },
    ),
    event("card_review", { rating: 3 }, { card_id: "C1", run_id: "RV" }),
  ],
  cards: [{ id: "C1", lexeme_key: "lex:de:hallo:word" }],
});
const check = (stored: Stored) =>
  lessonProblems(stored, lesson, locale, "de", { rated: 1, finished: true });

test("stored as it should be: no problems", () => {
  expect(check(whole())).toEqual([]);
});

test("each thing broken is named", () => {
  const broken = (change: (s: Stored) => void) => {
    const s = whole();
    change(s);
    return check(s).join("\n");
  };
  expect(
    broken((s) => (s.runs[0] = { ...s.runs[0], status: "active" } as Stored["runs"][0])),
  ).toContain("not finished/completed");
  expect(broken((s) => (s.events = s.events.filter((e) => e.type !== "page_shown")))).toContain(
    "never shown",
  );
  expect(broken((s) => (s.events = s.events.filter((e) => e.type !== "answered")))).toContain(
    "neither answered nor skipped",
  );
  expect(
    broken((s) => {
      const a = s.events.find((e) => e.type === "answered") as EventRow;
      a.payload_json = a.payload_json.replace('"wrong"', '"correct"');
    }),
  ).toContain("the engine says wrong");
  expect(broken((s) => (s.events = s.events.filter((e) => e.type !== "step_done")))).toContain(
    "step words not recorded",
  );
  expect(broken((s) => (s.cards = []))).toContain("0 cards for the lesson's 1 words");
  expect(broken((s) => (s.events = s.events.filter((e) => e.type !== "card_review")))).toContain(
    "0 card reviews stored for 1 given",
  );
});
