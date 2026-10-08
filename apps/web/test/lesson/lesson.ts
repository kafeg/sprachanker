// A synthetic lesson for the player's tests: two single-choice exercises, a word, a grammar and a culture
// page — our own text, nothing from a course.
import type { Exercise, Lesson, LocaleLesson, TypedEvent } from "@sprachanker/schema";

const KEY = "sprachanker.test/demo/00-01";
const choice = (n: number): Exercise =>
  ({
    key: `${KEY}/ex-0${n}`,
    type: "single_choice",
    fingerprint: "x",
    newWords: [],
    ruleIds: [],
    items: [
      {
        key: `${KEY}/ex-0${n}#1`,
        prompt: `Frage ${n}?`,
        options: [
          { id: "a", text: "Ja." },
          { id: "b", text: "Nein." },
        ],
        answer: { optionIds: ["a"] },
      },
    ],
  }) as unknown as Exercise;

export const lesson = {
  format: 1,
  key: KEY,
  unit: "sprachanker.test/demo/u-00",
  media: {},
  goals: [],
  pages: [{ exercise: choice(1) }, { exercise: choice(2) }],
  vocab: [{ key: `${KEY}/v-hallo`, lexeme: "lex:de:hallo:word", target: "hallo" }],
  unmapped: [],
} as unknown as Lesson;

export const locale = {
  format: 1,
  edition: "en-de",
  lesson: KEY,
  sourceId: "1",
  title: "Hallo",
  exercises: {
    [`${KEY}/ex-01`]: { sourceId: "2", title: "First", items: {} },
    [`${KEY}/ex-02`]: { sourceId: "3", title: "Second", items: {} },
  },
  vocab: {},
  tabs: {
    grammar: [{ sourceId: "4", title: "Grammar page", bodyHtml: "<p>g</p>" }],
    culture: [{ sourceId: "5", title: "Culture page", bodyHtml: "<p>c</p>" }],
  },
  downloads: [],
} as unknown as LocaleLesson;

let n = 0;
/** An answer to an item as the run stores it, with its outcome. */
export const answered = (item: string, optionId: string, attempt = 1): TypedEvent =>
  ({
    id: `E${++n}`,
    runId: "R",
    ts: n,
    type: "answered",
    itemKey: `${KEY}/${item}`,
    payload: {
      answer: { optionId },
      attempt,
      ms: 1,
      outcome: {
        result: optionId === "a" ? "correct" : "wrong",
        score: optionId === "a" ? 1 : 0,
        ruleIds: [],
        lexemes: [],
      },
    },
  }) as TypedEvent;
