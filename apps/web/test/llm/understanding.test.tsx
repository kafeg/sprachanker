// The Understanding step (09): a text heard first — who reads it named, its questions answered by ear
// with the text hidden —, then shown with its glossed words marked and its reading questions; a text
// to read shown at once; without a voice for the language, shown to read with all its questions and
// the step saying what listening needs; the lesson's earlier texts listed with their scores.
import { expect, test } from "bun:test";
import type { UnderstandingText } from "@sprachanker/schema";
import type { Understood } from "../../src/llm/api.ts";
import { UnderstandingStep } from "../../src/llm/understanding.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

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

const step = (texts: Understood[], voices: unknown = PIPER) =>
  renderApp(
    <TargetLang value="de">
      <UnderstandingStep {...ids} />
    </TargetLang>,
    {
      data: [
        llm,
        [["settings"], { "speech.readEngine": "piper" }],
        [["piper-voices"], voices],
        [["understanding", ids.lessonKey], { texts, preparing: false }],
      ],
    },
  );

test("a dialogue heard first: who reads it (both voices), its questions by ear, the text hidden", async () => {
  const view = await step([understood()]);
  expect(view.getByRole("heading", { name: "At the bakery" })).toBeTruthy();
  expect(view.getByText(/a dialogue to listen to/)).toBeTruthy();
  expect(view.getByText("Read by Piper · thorsten and eva k")).toBeTruthy();
  expect(view.getByRole("button", { name: "Listen" })).toBeTruthy();
  expect(view.getByText(/Answer by ear/)).toBeTruthy();
  expect(view.getByText("Anna möchte drei Brötchen.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Richtig" })).toBeTruthy();
  // The answer typed is checked when asked.
  expect(view.getByRole("button", { name: "Check" })).toBeTruthy();
  // Neither the text nor its reading question yet.
  expect(view.queryByText("The text")).toBeNull();
  expect(view.queryByText(/Das macht 1,20 Euro/)).toBeNull();
  expect(view.queryByText("Wer verkauft?")).toBeNull();
  view.unmount();
});

test("answered by ear: the text opens, its glossed words marked, and its reading question follows; all answered, the score", async () => {
  const heard = [answer(0, { optionId: "b" }, "correct"), answer(1, { g1: "2,10" }, "wrong")];
  const view = await step([understood(heard)]);
  expect(view.getByText("The text")).toBeTruthy();
  expect(view.getByText(/Das macht 1,20 Euro/)).toBeTruthy();
  const marked = view.getByText("Brötchen", { selector: "mark" });
  expect(marked.getAttribute("title")).toBe("roll");
  expect(view.getByText("New words")).toBeTruthy();
  expect(view.getByText("Read the text and answer")).toBeTruthy();
  expect(view.getByText("Wer verkauft?")).toBeTruthy();
  // The answers by ear stay, checked.
  expect(view.getAllByRole("status").map((s) => s.textContent)).toEqual(["Correct", "Not quite"]);
  expect(view.queryByText(/Answer by ear/)).toBeNull();
  view.unmount();

  const done = await step([understood([...heard, answer(2, { optionId: "b" }, "correct")])]);
  expect(done.getByText("2 of 3 right")).toBeTruthy();
  done.unmount();
});

test("a text to read is shown at once, nothing to listen to", async () => {
  const menu: UnderstandingText = {
    ...TEXT,
    kind: "reading",
    lines: [{ text: "Brötchen 0,60 €" }, { text: "Kaffee 2,50 €" }],
  };
  const view = await step([understood([], menu)]);
  expect(view.getByText(/a text to read/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Listen" })).toBeNull();
  expect(view.getByText("Kaffee 2,50 €")).toBeTruthy();
  expect(view.getByText("Anna möchte drei Brötchen.")).toBeTruthy();
  view.unmount();
});

test("nothing here reads the language: the step says what listening needs and shows the text with all its questions", async () => {
  const view = await step([understood()], { engine: true, auto: {}, voices: [] });
  expect(view.getByText(/Nothing here reads German aloud/)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Listen" })).toBeNull();
  expect(view.getByText(/Das macht 1,20 Euro/)).toBeTruthy();
  expect(view.getByText("Anna möchte drei Brötchen.")).toBeTruthy();
  expect(view.getByText("Wer verkauft?")).toBeTruthy();
  view.unmount();
});

test("no text yet: what the step is and the way to write one; earlier texts listed with their scores", async () => {
  const none = await step([]);
  expect(none.getByText(/A short text from the words you know/)).toBeTruthy();
  expect(none.getByRole("button", { name: "Write a text" })).toBeTruthy();
  none.unmount();

  const earlier = {
    ...understood([answer(0, { optionId: "a" }, "wrong")]),
    id: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A72",
  };
  const view = await step([understood(), earlier]);
  expect(view.getByText("Earlier texts of this lesson")).toBeTruthy();
  expect(view.getByText("0 of 3 right")).toBeTruthy();
  expect(view.getByRole("button", { name: "New text" })).toBeTruthy();
  view.unmount();
});
