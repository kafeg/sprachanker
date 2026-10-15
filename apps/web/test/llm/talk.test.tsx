// Speaking: a monologue's card — what to talk about, the topic and three points in the language
// learnt, how long —, said (typed here: nothing hears in the test), kept, then Check in the step bar;
// checked, the writing check's view with a model answer. A role-play: the situation and the learner's
// role, the partner's first line, the learner's hint; each line said and kept, the partner's next
// one coming, Check once every line is said; checked, each line's verdict and a good way to say it.
import { expect, test } from "bun:test";
import type { MonologueCard, Roleplay, TalkAttempt } from "@sprachanker/schema";
import { fireEvent, waitFor } from "@testing-library/react";
import type { PracticePrimary } from "../../src/lesson/slots.ts";
import { TalkStep } from "../../src/llm/talk.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";
import { practiceLesson, server } from "./practice-lesson.ts";

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
const llm: [unknown[], unknown] = [["llm"], { provider: "custom", model: "test-model" }];

const verdict = <T,>(task: string, result: T, ts: number, input = "") => ({
  task,
  input,
  result,
  model: "lab/test-model",
  latencyMs: 10,
  id: `01K7A0Z8ZQ4J1V2W3X4Y5Z6A7${ts}`,
  runId: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A71",
  itemKey: null,
  cardId: null,
  ts,
});

const CARD: MonologueCard = {
  kind: "monologue",
  setting: "About yourself",
  instruction: "Introduce yourself: say the three points below.",
  topic: "Über mich",
  points: ["Name?", "Woher?", "Hobby?"],
  seconds: 30,
  model: "Ich heiße Mara. Ich komme aus Polen. Ich lese gern.",
};

const ROLEPLAY: Roleplay = {
  kind: "roleplay",
  setting: "At a café",
  situation: "You order in a café.",
  role: "a guest",
  learner: "Gast",
  partner: { name: "Herr Brandt", gender: "m", age: "adult" },
  lines: [
    { speaker: "Herr Brandt", text: "Guten Tag! Was möchten Sie?" },
    { speaker: "Gast", text: "Einen Kaffee, bitte." },
    { speaker: "Herr Brandt", text: "Gern. Sonst noch etwas?" },
    { speaker: "Gast", text: "Nein, danke." },
  ],
  cues: [
    { n: 1, cue: "Order a coffee." },
    { n: 3, cue: "Say you want nothing else." },
  ],
  glossary: [],
};

const step = (
  state: Record<string, unknown>,
  setPrimary: (p: PracticePrimary | null) => void = () => {},
  left = 0,
) =>
  renderApp(
    <TargetLang value="de">
      <TalkStep {...ids} setPrimary={setPrimary} />
    </TargetLang>,
    {
      data: [
        llm,
        practiceLesson(ids, left),
        [
          ["talk", ids.lessonKey],
          { task: null, attempts: [], preparing: false, checking: false, step: null, ...state },
        ],
      ],
    },
  );

/** A line typed where nothing hears, and kept. */
const say = (view: Awaited<ReturnType<typeof step>>, text: string) => {
  fireEvent.change(view.getByPlaceholderText("Your line…"), { target: { value: text } });
  fireEvent.submit(view.getByPlaceholderText("Your line…").closest("form") as HTMLFormElement);
};

/** The server after a task is taken: the step's state, the lesson's practice. */
const answers = (path: string) =>
  path.endsWith("/practice/lesson")
    ? practiceLesson(ids)[1]
    : { task: null, attempts: [], preparing: false, checking: false, step: null };

test("no task yet: the course's next taken as the step opens; with a task, Another version while the course has more", async () => {
  const asked = server(answers);
  const view = await step({}, () => {}, 1);
  await waitFor(() =>
    expect(asked[0]).toBe(
      `POST /api/llm/practice/next ${JSON.stringify({ ...ids, step: "speaking", ifNone: true })}`,
    ),
  );
  view.unmount();
  const more = await step({ task: verdict("talk_task", CARD, 1) }, () => {}, 1);
  expect(more.getByRole("button", { name: "Another version" })).toBeTruthy();
  more.unmount();
});

test("a monologue: the card, a take kept, then Check in the step bar", async () => {
  const bar: { primary: PracticePrimary | null } = { primary: null };
  const view = await step({ task: verdict("talk_task", CARD, 1) }, (p) => {
    bar.primary = p;
  });
  expect(view.getByText("About yourself")).toBeTruthy();
  expect(view.getByText("Über mich")).toBeTruthy();
  for (const p of CARD.points) expect(view.getByText(p)).toBeTruthy();
  expect(view.getByText("Speak for about 30 seconds.")).toBeTruthy();
  expect(bar.primary).toBeNull();
  say(view, "Ich heiße Anna und komme aus Spanien.");
  expect(view.getByText("Ich heiße Anna und komme aus Spanien.")).toBeTruthy();
  await waitFor(() => expect(bar.primary?.label).toBe("Check"));
  view.unmount();
});

test("a monologue checked: the check as a writing check shows it, the model answer", async () => {
  const attempt: TalkAttempt = {
    task: CARD,
    said: [{ n: 0, text: "Ich heiße Anna." }],
    check: {
      verdict: "minor_errors",
      corrected: "Ich heiße Anna.",
      corrections: [],
      criteria: {
        task: { score: 1, comment: "Two points missing." },
        communication: { score: 2, comment: "Clear." },
        accuracy: { score: 2, comment: "Fine." },
      },
      points: [
        { score: 2, comment: "Said." },
        { score: 0, comment: "Not said." },
        { score: 0, comment: "Not said." },
      ],
      modelText: "",
      feedback: "Say where you come from too.",
    },
  };
  const view = await step({
    task: verdict("talk_task", CARD, 1),
    attempts: [verdict("talk", attempt, 2, "Ich heiße Anna.")],
  });
  expect(view.getByText("Say where you come from too.")).toBeTruthy();
  expect(view.getByText("A model answer")).toBeTruthy();
  expect(view.getByText(CARD.model)).toBeTruthy();
  view.unmount();
});

test("a role-play: the partner's line, the learner's hint; each line said and kept, Check once all are", async () => {
  const bar: { primary: PracticePrimary | null } = { primary: null };
  const view = await step({ task: verdict("talk_task", ROLEPLAY, 1) }, (p) => {
    bar.primary = p;
  });
  expect(view.getByText("You order in a café.")).toBeTruthy();
  expect(view.getByText("You are: a guest")).toBeTruthy();
  expect(view.getByText("Guten Tag! Was möchten Sie?")).toBeTruthy();
  expect(view.getByText("Order a coffee.")).toBeTruthy();
  // The partner's next line comes only once the learner's is said.
  expect(view.queryByText("Gern. Sonst noch etwas?")).toBeNull();
  say(view, "Einen Kaffee, bitte.");
  expect(view.getByText("Gern. Sonst noch etwas?")).toBeTruthy();
  expect(bar.primary).toBeNull();
  say(view, "Nein, danke.");
  await waitFor(() => expect(bar.primary?.label).toBe("Check"));
  view.unmount();
});

test("a role-play checked: each line's verdict, its corrections and a good way to say it", async () => {
  const attempt: TalkAttempt = {
    task: ROLEPLAY,
    said: [
      { n: 1, text: "Ein Kaffee, bitte." },
      { n: 3, text: "Nein, danke." },
    ],
    check: {
      turns: [
        {
          n: 1,
          fits: true,
          corrections: [{ wrong: "Ein", right: "Einen", explanation: "Accusative." }],
        },
        { n: 3, fits: true, corrections: [] },
      ],
      feedback: "Well done.",
    },
  };
  const view = await step({
    task: verdict("talk_task", ROLEPLAY, 1),
    attempts: [verdict("talk", attempt, 2)],
  });
  expect(view.getByText("2 of 2 lines fit")).toBeTruthy();
  expect(view.getByText("Well done.")).toBeTruthy();
  expect(view.getByText("Accusative.")).toBeTruthy();
  expect(view.getAllByText(/A good way to say it/)).toHaveLength(2);
  view.unmount();
});
