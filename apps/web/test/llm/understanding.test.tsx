// Reading and Listening, done as an exercise: what the text is and the task, nothing of what it
// says; Listening's recording in the course's player, who reads it named (its people's own voices),
// the text hidden; Reading's text shown; the questions answered, Check in the step bar; checked, the
// title and situation open, Listening's text with its glossed words, the score. Without a voice for
// the language a text to hear is shown to read; the step's earlier texts listed with their scores.
import { expect, test } from "bun:test";
import type { UnderstandingText } from "@sprachanker/schema";
import { fireEvent, waitFor } from "@testing-library/react";
import type { PracticePrimary } from "../../src/lesson/slots.ts";
import type { Understood } from "../../src/llm/api.ts";
import { UnderstandingStep } from "../../src/llm/understanding.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";
import { practiceLesson, server } from "./practice-lesson.ts";

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
const llm: [unknown[], unknown] = [["llm"], { provider: "custom", model: "test-model" }];

const TEXT: UnderstandingText = {
  kind: "dialogue",
  title: "At the bakery",
  situation: "Anna buys rolls.",
  lines: [
    { speaker: "Anna", text: "Guten Morgen! Zwei Brötchen, bitte." },
    { speaker: "Verkäufer", text: "Gern. Das macht 1,20 Euro." },
  ],
  glossary: [{ word: "Brötchen", translation: "roll" }],
  questions: [
    {
      phase: "listening",
      question: "Anna möchte drei Brötchen.",
      options: ["Richtig", "Falsch"],
      answer: 1,
    },
    { phase: "listening", question: "Wie viel kostet das?", accepted: ["1,20", "1,20 Euro"] },
    {
      phase: "reading",
      question: "Wer verkauft?",
      options: ["Anna", "der Verkäufer", "niemand"],
      answer: 1,
    },
  ],
};

const answer = (
  question: number,
  value: Record<string, string>,
  result: "correct" | "wrong",
): Understood["answers"][number] => ({
  verdict: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
  question,
  answer: value,
  outcome: { result, score: result === "correct" ? 1 : 0 },
  ts: 2,
});

const understood = (
  answers: Understood["answers"] = [],
  result: UnderstandingText = TEXT,
): Understood => ({
  task: "understanding",
  input: "",
  result,
  model: "lab/test-model",
  latencyMs: 10,
  id: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
  runId: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A71",
  itemKey: null,
  cardId: null,
  ts: 1_790_000_000_000,
  answers,
});

const voice = (id: string, name: string) => ({
  id,
  lang: "de",
  region: "DE",
  name,
  quality: "medium",
  bytes: 1,
  installed: true,
});
const PIPER = {
  engine: true,
  auto: { de: "de_DE-thorsten-medium" },
  voices: [voice("de_DE-thorsten-medium", "thorsten"), voice("de_DE-eva_k-x_low", "eva_k")],
};

const step = (
  texts: Understood[],
  voices: unknown = PIPER,
  which: "reading" | "listening" = "listening",
  setPrimary: (p: PracticePrimary | null) => void = () => {},
  left = 0,
) =>
  renderApp(
    <TargetLang value="de">
      <UnderstandingStep {...ids} step={which} setPrimary={setPrimary} />
    </TargetLang>,
    {
      data: [
        llm,
        [["settings"], { "speech.readEngine": "piper" }],
        [["piper-voices"], voices],
        [["understanding", ids.lessonKey, which], { texts, preparing: false }],
        practiceLesson(ids, left),
        // The recording, made by the server (as a URL for the player).
        [["understanding-audio", "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70"], "blob:recording"],
      ],
    },
  );

/** A text Listening made: what it is, its people with their gender and the voices they were given. */
const MADE: UnderstandingText = {
  ...TEXT,
  step: "listening",
  genre: "conversation",
  setting: "A talk at a bakery",
  people: [
    { name: "Anna", gender: "f", age: "adult" },
    { name: "Verkäufer", gender: "m", age: "senior" },
  ],
  voices: {
    engine: "piper",
    by: { Anna: "de_DE-eva_k-x_low", Verkäufer: "de_DE-thorsten-medium" },
  },
  questions: TEXT.questions.map((q) => ({ ...q, phase: "listening" as const })),
};
const ALL = [
  answer(0, { optionId: "b" }, "correct"),
  answer(1, { g1: "1,20" }, "correct"),
  answer(2, { optionId: "a" }, "wrong"),
];

test("Listening: what it is and the task, the recording in the course's player read by its people's voices; the text and what it is about hidden; Check waits", async () => {
  const bar: { primary: PracticePrimary | null } = { primary: null };
  const view = await step([understood([], MADE)], PIPER, "listening", (p) => {
    bar.primary = p;
  });
  expect(view.getByText("A talk at a bakery")).toBeTruthy();
  expect(view.getByText(/Listen and answer the questions/)).toBeTruthy();
  expect(view.getByText("Read by Piper · eva k and thorsten")).toBeTruthy();
  expect(view.getByRole("group", { name: "The recording" })).toBeTruthy();
  expect(view.getByText("Wer verkauft?")).toBeTruthy();
  // Nothing of what it says before it is checked.
  expect(view.queryByText("At the bakery")).toBeNull();
  expect(view.queryByText("Anna buys rolls.")).toBeNull();
  expect(view.queryByText(/Das macht 1,20 Euro/)).toBeNull();
  // The answer typed is a number: said in its field, no letters under it.
  expect(view.getByPlaceholderText("in digits")).toBeTruthy();
  expect(view.queryByRole("button", { name: "ä" })).toBeNull();
  // Choosing checks nothing: Check in the step bar waits for every answer.
  fireEvent.click(view.getByRole("button", { name: "Falsch" }));
  expect(view.queryByRole("status")).toBeNull();
  await waitFor(() =>
    expect(bar.primary).toMatchObject({
      label: "Check",
      disabled: true,
      note: "Answer every item · 1 of 3",
    }),
  );
  view.unmount();
});

test("checked: each question's outcome, then the title and situation, the text with its glossed words, the score; Check gives the bar back", async () => {
  const bar: { primary?: PracticePrimary | null } = {};
  const view = await step([understood(ALL, MADE)], PIPER, "listening", (p) => {
    bar.primary = p;
  });
  expect(view.getAllByRole("status").map((s) => s.textContent)).toEqual([
    "Correct",
    "Correct",
    "Wrong",
  ]);
  expect(view.getByText("At the bakery")).toBeTruthy();
  expect(view.getByText(/Anna buys rolls\./)).toBeTruthy();
  expect(view.getByText(/Das macht 1,20 Euro/)).toBeTruthy();
  expect(view.getByText("Brötchen", { selector: "mark" }).getAttribute("title")).toBe("roll");
  expect(view.getByText("2 of 3 right")).toBeTruthy();
  await waitFor(() => expect(bar.primary).toBeNull());
  view.unmount();
});

test("voices given for another engine than the profile's: its people given this engine's, by their gender", async () => {
  const qwen: UnderstandingText = {
    ...MADE,
    voices: { engine: "qwen", by: { Anna: "serena", Verkäufer: "ryan" } },
  };
  const view = await step([understood([], qwen)]);
  // Piper's man's voice for the (older) seller, its woman's for Anna.
  expect(view.getByText("Read by Piper · thorsten and eva k")).toBeTruthy();
  view.unmount();
});

test("Reading: the text shown at once with its questions, nothing to listen to; what it is about after Check", async () => {
  const menu: UnderstandingText = {
    ...TEXT,
    kind: "reading",
    step: "reading",
    setting: "A bakery's price list",
    lines: [{ text: "Brötchen 0,60 €" }, { text: "Kaffee 2,50 €" }],
  };
  const view = await step([understood([], menu)], PIPER, "reading");
  expect(view.getByText("A bakery's price list")).toBeTruthy();
  expect(view.getByText(/Read the text and answer/)).toBeTruthy();
  expect(view.queryByRole("group", { name: "The recording" })).toBeNull();
  expect(view.getByText("Kaffee 2,50 €")).toBeTruthy();
  expect(view.getByText("Anna möchte drei Brötchen.")).toBeTruthy();
  expect(view.queryByText("At the bakery")).toBeNull();
  view.unmount();
});

test("nothing here reads the language: the step says what listening needs and shows the text with its questions", async () => {
  const view = await step([understood()], { engine: true, auto: {}, voices: [] });
  expect(view.getByText(/Nothing here reads German aloud/)).toBeTruthy();
  expect(view.queryByRole("group", { name: "The recording" })).toBeNull();
  expect(view.getByText(/Das macht 1,20 Euro/)).toBeTruthy();
  expect(view.getByText("Wer verkauft?")).toBeTruthy();
  view.unmount();
});

/** The server after a text is taken: the step's texts, the lesson's practice. */
const answers = (path: string) =>
  path.endsWith("/practice/lesson")
    ? practiceLesson(ids)[1]
    : path.endsWith("/understanding")
      ? { texts: [understood()], preparing: false }
      : {};

test("no text yet: the course's next taken as the step opens; earlier texts listed with their scores; Another version while the course has more", async () => {
  const asked = server(answers);
  const none = await step([], PIPER, "listening", () => {}, 2);
  await waitFor(() =>
    expect(asked[0]).toBe(
      `POST /api/llm/practice/next ${JSON.stringify({ ...ids, step: "listening", ifNone: true })}`,
    ),
  );
  none.unmount();

  const earlier = {
    ...understood([answer(0, { optionId: "a" }, "wrong")]),
    id: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A72",
  };
  const view = await step([understood(), earlier]);
  expect(view.getByText("Earlier texts of this lesson")).toBeTruthy();
  expect(view.getByText("0 of 3 right")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Another version" })).toBeNull();
  view.unmount();
  const more = await step([understood()], PIPER, "listening", () => {}, 1);
  const taken = server(answers);
  fireEvent.click(more.getByRole("button", { name: "Another version" }));
  await waitFor(() => expect(taken[0]).toStartWith("POST /api/llm/practice/next"));
  more.unmount();
});
