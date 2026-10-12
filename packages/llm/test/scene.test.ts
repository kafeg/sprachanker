// The Dialogue's tasks (07): a setup with an information gap, a line judged (understood, fits, at
// most two corrections of that line), a summary with model lines.
import { expect, test } from "bun:test";
import type { LlmClient } from "../src/client.ts";
import { runStructured } from "../src/structured.ts";
import {
  cleanSceneSummary,
  cleanSceneTurn,
  repeatedQuestion,
  type SceneTurn,
  sceneSetupTask,
  sceneSummaryRules,
  sceneSummaryTask,
  sceneTurnRequest,
  sceneTurnRules,
  sceneTurnTask,
} from "../src/tasks/scene.ts";

const turn = (extra: Partial<SceneTurn>): SceneTurn => ({
  reply: "Woher kommst du?",
  translation: "Откуда ты?",
  understood: true,
  fits: true,
  corrections: [],
  goalsMet: [],
  done: false,
  ...extra,
});

const SETUP = {
  title: "Am Bahnhof",
  situation: "Вы на вокзале.",
  partner: "Кассир",
  goals: ["Узнать, когда идёт поезд", "Узнать цену"],
  opening: "Guten Tag! Wohin möchten Sie?",
  openingTranslation: "Здравствуйте! Куда вы хотите?",
  partnerInfo: ["Der Zug nach Berlin fährt um 14:30.", "Das Ticket kostet 29 Euro."],
};

const RU_DE = { language: "ru", target: "de" };

/** A model answering with `replies` in order. */
const scripted = (replies: unknown[]): LlmClient => ({
  models: async () => [],
  chat: () => (async function* () {})(),
  complete: async () => JSON.stringify(replies.shift()),
});

test("cleanSceneTurn: only corrections of the new line, at most two; goals accumulate, done when all met", () => {
  const cleaned = cleanSceneTurn(
    turn({
      corrections: [
        { wrong: "Ich bin heissen", right: "Ich heiße", explanation: "old line" },
        { wrong: "er heisst", right: "er heißt", explanation: "new" },
        { wrong: "Max", right: "Max", explanation: "no-op" },
        // Capitals alone are no error (a spoken line's are the recogniser's).
        { wrong: "max.", right: "Max.", explanation: "case" },
        // Nor is punctuation: a quote compared without it, a change of it alone dropped.
        { wrong: "Das ist Max", right: "Das ist Max!", explanation: "punctuation" },
        { wrong: "Heisst Max?", right: "heißt Max", explanation: "second" },
        { wrong: "das ist", right: "dies ist", explanation: "third: one too many" },
      ],
      goalsMet: [1, 7],
    }),
    "Das ist Max, er  heisst max.",
    2,
    [0],
    RU_DE,
  );
  expect(cleaned.corrections.map((c) => c.explanation)).toEqual(["new", "second"]);
  expect(cleaned.goalsMet).toEqual([0, 1]);
  expect(cleaned.done).toBe(true);
  expect([cleaned.understood, cleaned.fits]).toEqual([true, true]);
});

test("cleanSceneTurn: the model's `done` does not end a Dialogue whose goals are not all met", () => {
  const early = cleanSceneTurn(turn({ done: true, goalsMet: [0] }), "Hallo", 2, [], RU_DE);
  expect([early.goalsMet, early.done]).toEqual([[0], false]);
  const met = cleanSceneTurn(turn({ done: false, goalsMet: [1] }), "Hallo", 2, [0], RU_DE);
  expect(met.done).toBe(true);
});

test("sceneTurnRequest: user first, the opening kept, the partner's facts in the scene, a spoken line marked", () => {
  const base = {
    language: "ru",
    target: "de",
    lesson: { title: "L", goals: [], vocab: [], grammarHtml: [] },
    setup: SETUP,
    message: "wann fährt der zug nach berlin",
  };
  const fresh = sceneTurnRequest({
    ...base,
    history: [{ role: "assistant", text: SETUP.opening }],
    spoken: true,
  });
  expect(fresh.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  expect(fresh.messages.at(-1)?.content).toBe("<line said>wann fährt der zug nach berlin</line>");
  const system = String(fresh.messages[0]?.content);
  expect(system).toContain("0. Узнать, когда идёт поезд; 1. Узнать цену");
  expect(system).toContain(
    "You know: Der Zug nach Berlin fährt um 14:30. Das Ticket kostet 29 Euro.",
  );
  // Recognised speech is taken as a listener would understand it (owner, 2026-10-11).
  expect(system).toContain("never errors");
  const named = sceneTurnRequest({
    ...base,
    lesson: { ...base.lesson, characters: ["Nico"] },
    history: [{ role: "assistant", text: SETUP.opening }],
  });
  expect(String(named.messages[0]?.content)).toContain("The course's characters: Nico");
  expect(system).toContain('"understood"');
  // Typed (no microphone): a plain line; a scene from before the Dialogue has no facts.
  const typed = sceneTurnRequest({
    ...base,
    setup: { ...SETUP, partnerInfo: undefined },
    history: [{ role: "assistant", text: SETUP.opening }],
  });
  expect(typed.messages.at(-1)?.content).toBe("<line>wann fährt der zug nach berlin</line>");
  expect(String(typed.messages[0]?.content)).not.toContain("You know:");
});

test("sceneSetupTask: the level and place with the data; of many earlier words the most recent are kept", () => {
  const knownWords = Array.from({ length: 2000 }, (_, i) => ({ target: `wort${i}` }));
  const task = sceneSetupTask({
    language: "ru",
    target: "de",
    lesson: {
      title: "Im Café",
      goals: [],
      vocab: [],
      grammarHtml: [],
      level: "A2",
      place: { n: 3, of: 30 },
      knownWords,
      topics: [{ title: "Modalverben", lesson: "3.1" }],
      characters: ["Nico", "Lisa"],
    },
  });
  const [system, data] = task.request.messages.map((m) => String(m.content));
  // The course's people named, so the partner made up is none of them.
  expect(data).toContain("The course's characters: Nico, Lisa");
  expect(data).toContain("wort1999");
  expect(data).not.toContain("wort0;");
  expect(data).toContain("Learner's level: A2");
  expect(data).toContain("Place in the course: lesson 3 of 30");
  expect(data).toContain("Grammar met so far: Modalverben");
  expect(system).not.toContain("A1");
  expect(system).toContain("information gap");
});

test("sceneTurnTask: a reply ending with the question the partner's last line ended with is asked again once", async () => {
  const sent: string[] = [];
  const replies = [
    turn({ reply: "Der Zug fährt um 14:30. Haben Sie noch eine Frage?" }),
    turn({ reply: "Um 14:30. Fahren Sie oft nach Berlin?" }),
  ];
  const client: LlmClient = {
    models: async () => [],
    chat: () => (async function* () {})(),
    complete: async (request) => {
      sent.push(String(request.messages.at(-1)?.content));
      return JSON.stringify(replies.shift());
    },
  };
  const task = sceneTurnTask({
    ...RU_DE,
    lesson: { title: "L", goals: [], vocab: [], grammarHtml: [] },
    setup: SETUP,
    history: [
      { role: "assistant", text: SETUP.opening },
      { role: "user", text: "Nach Berlin." },
      { role: "assistant", text: "Gut. Haben Sie noch eine Frage?" },
    ],
    message: "Wann fährt der Zug?",
  });
  expect((await runStructured(client, "m", task)).reply).toBe(
    "Um 14:30. Fahren Sie oft nach Berlin?",
  );
  expect(sent[1]).toContain("ends with the same question as your last line");
  // Compared without case and punctuation; the opening is the last line before any; no question, no check.
  expect(
    repeatedQuestion("Ja. haben sie noch eine frage", "Hallo! Haben Sie noch eine Frage?"),
  ).toBe(undefined);
  expect(
    repeatedQuestion("Ja! Haben Sie noch eine Frage ?", "Hallo. haben Sie noch eine Frage?"),
  ).toBeString();
  expect(repeatedQuestion("Gern. Und Sie?", "Wohin möchten Sie?")).toBeUndefined();
  expect(repeatedQuestion("Gern.", "Gern.")).toBeUndefined();
});

test("sceneSetupTask: a setup without the partner's facts is repaired once", async () => {
  const task = sceneSetupTask({
    language: "ru",
    target: "de",
    lesson: { title: "Am Bahnhof", goals: [], vocab: [], grammarHtml: [] },
  });
  const { partnerInfo: _, ...withoutFacts } = SETUP;
  const setup = await runStructured(scripted([withoutFacts, SETUP]), "m", task);
  expect(setup.partnerInfo).toEqual(SETUP.partnerInfo);
});

test("sceneSummaryTask: the goals reached, the lines with their corrections; cleaned to two corrections of the learner's lines, each with a model line", () => {
  const task = sceneSummaryTask({
    language: "ru",
    target: "de",
    lesson: { title: "Am Bahnhof", goals: [], vocab: [], grammarHtml: [], level: "A1" },
    setup: SETUP,
    goalsMet: [0],
    turns: [
      { role: "assistant", text: SETUP.opening },
      {
        role: "user",
        text: "wann fahrt der zug",
        corrections: [{ wrong: "fahrt", right: "fährt", explanation: "Umlaut." }],
      },
      { role: "assistant", text: "Um 14:30." },
    ],
  });
  expect(task.name).toBe("scene_summary");
  const data = String(task.request.messages[1]?.content);
  expect(data).toContain("Goals reached: 1 of 2 (Узнать, когда идёт поезд)");
  expect(data).toContain("Learner: wann fahrt der zug\n  (corrected: fahrt → fährt)");
  expect(data).toContain("Partner: Um 14:30.");
  expect(data).toContain("Learner's level: A1");

  const cleaned = cleanSceneSummary(
    {
      corrections: [
        { wrong: "fahrt", right: "fährt", explanation: "", model: "Wann fährt der Zug?" },
        { wrong: "not said", right: "x", explanation: "", model: "x" },
        { wrong: "wann", right: "Wann", explanation: "case", model: "Wann?" },
        { wrong: "der zug", right: "der Zug nach Berlin", explanation: "", model: "" },
        { wrong: "wann", right: "Wann genau", explanation: "", model: "Wann genau?" },
      ],
      feedback: "Gut.",
    },
    ["wann fahrt der zug"],
    RU_DE,
  );
  expect(cleaned.corrections.map((c) => [c.right, c.model])).toEqual([
    ["fährt", "Wann fährt der Zug?"],
    ["der Zug nach Berlin", "der Zug nach Berlin"],
  ]);
});

test("corrections that are no corrected wording are dropped: a remark in the learner's script, alternatives, arrows, nothing changed", () => {
  const line = "Wann fängt deine Schule an und wann sie endet?";
  const fix = (right: string) => ({ wrong: "wann sie endet", right, explanation: "…" });
  const kept = (corrections: SceneTurn["corrections"], langs = RU_DE, said = line) =>
    cleanSceneTurn(turn({ corrections }), said, 2, [], langs).corrections.map((c) => c.right);
  expect(
    kept([
      fix("правильно"),
      fix("wann sie endet -> und wann sie endet (ладно)"),
      fix("wann endet sie → besser"),
      fix("wirklich toll / echt gut"),
      fix("wann sie endet"),
      fix("   "),
      fix("wann endet sie"),
    ]),
  ).toEqual(["wann endet sie"]);
  // A learner whose language shares the learnt one's script: nothing to tell apart by script.
  expect(kept([fix("wann endet sie")], { language: "en", target: "de" })).toEqual([
    "wann endet sie",
  ]);
  // Learning a language in another script: its own letters (kana, Han) are right words.
  expect(
    kept(
      [
        { wrong: "すし", right: "так правильно", explanation: "…" },
        { wrong: "すし", right: "寿司", explanation: "…" },
      ],
      { language: "ru", target: "ja" },
      "すし を ください",
    ),
  ).toEqual(["寿司"]);
});

test("cleanSceneSummary: a model line that repeats its error gets the correction made in it", () => {
  const cleaned = cleanSceneSummary(
    {
      corrections: [
        {
          wrong: "wann sie endet",
          right: "wann endet sie",
          explanation: "…",
          model: "Wann fängt deine Schule an und wann sie endet?",
        },
      ],
      feedback: "Gut.",
    },
    ["Wann fängt deine Schule an und wann sie endet?"],
    RU_DE,
  );
  expect(cleaned.corrections[0]?.model).toBe("Wann fängt deine Schule an und wann endet sie?");
});

test("sceneSetupTask: the goal kinds of the level, the lesson's grammar and the card's language with the data; the rules name no level", () => {
  const lesson = (level?: string) => ({
    title: "Schule",
    goals: ["Wünsche äußern"],
    vocab: [],
    grammarHtml: ["<h2>Konjunktiv II</h2><p>Wenn ich Zeit hätte, würde ich …</p>"],
    ...(level && { level }),
  });
  const messages = (level?: string) =>
    sceneSetupTask({ ...RU_DE, lesson: lesson(level) }).request.messages.map((m) =>
      String(m.content),
    );
  const data = (level?: string) => messages(level)[1] ?? "";
  expect(data("B1")).toContain(
    "Goals at this level: B1 — give an opinion with a reason (at least one goal does)",
  );
  expect(data("A1–A2")).toContain("Goals at this level: A1 — ask for and give simple facts");
  expect(data("A1–A2")).toContain("; A2 — arrange or ask for something");
  // No level named: a beginner's.
  expect(data()).toContain("Goals at this level: A1 — ");
  expect(data("B1")).toContain("This lesson's grammar:\nKonjunktiv II");
  // The card in the learner's language, even where the lesson's texts are in the learnt one.
  expect(data("B1")).toEndWith("Remember: title, situation, partner and goals in Russian.");
  const [system = ""] = messages("B1");
  for (const rule of [
    "never a character of the course",
    "needs this lesson's grammar",
    "asks nothing the learner cannot know",
    "true to the situation",
    "One form of address for the whole dialogue",
    "of the kinds given for the learner's level",
    "gender is unknown",
  ])
    expect(system).toContain(rule);
  expect(system).not.toMatch(/\b[ABC][12]\b/);
});

test("sceneTurnRules and sceneSummaryRules: the learner reaches the goals, the partner stays in role, corrections are the right words only; no gender, level or language assumed", () => {
  const names = { language: "{language}", target: "{target}" };
  const turnRules = sceneTurnRules("ru", "de", names);
  expect(turnRules).not.toContain("towards the learner's goals");
  expect(turnRules).toContain("never ask the learner's goal questions yourself");
  expect(turnRules).toContain("never offer or hint at a fact");
  // A person, not a help desk: a reaction and something of their own; "anything else?" once at most.
  expect(turnRules).toContain("Answer like a person in that situation");
  expect(turnRules).toContain("Ask whether there is anything else at most once");
  expect(turnRules).toContain("Never end two lines with the same question");
  expect(turnRules).toContain("in the form of address of your opening");
  expect(turnRules).toContain('Never correct the learner inside "reply"');
  expect(turnRules).toContain("only those words corrected, in {target}");
  const summaryRules = sceneSummaryRules("ru", "de", names);
  expect(summaryRules).toContain("with every error in it fixed");
  // The partner is none of the course's people; a correction never goes against a goal's form.
  expect(turnRules).toContain("never take one of their names");
  for (const rules of [turnRules, summaryRules]) {
    expect(rules).toMatch(/[Aa] correction keeps to the goals/);
    expect(rules).toContain("gender is unknown");
    expect(rules).not.toMatch(/\b[ABC][12]\b|German|Russian/);
  }
});
