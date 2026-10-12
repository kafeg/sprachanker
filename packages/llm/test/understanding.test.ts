// Reading and Listening's texts (07): the genres and their length by level and place, a draft
// planned and written from what the learner knows, its lines read from its text, drafts rated and
// the best kept, questions asked on the one kept, then answered with the text and without it — the
// questions not settled as the key does, or given away by common sense, left out.
import { expect, test } from "bun:test";
import type { UnderstandingText } from "@sprachanker/schema";
import type { LlmClient } from "../src/client.ts";
import { runStructured, structuredRequest } from "../src/structured.ts";
import { courseThird } from "../src/tasks/lesson.ts";
import {
  genresFor,
  pickAreas,
  pickGenre,
  questionCount,
  TEXT_GENRES,
  textWords,
} from "../src/tasks/text-genres.ts";
import {
  chooseDraft,
  type DraftRating,
  draftLines,
  draftProblem,
  practiceThird,
  settledQuestions,
  type UnderstandingDraft,
  understandingCheckTask,
  understandingDraftTask,
  understandingJudgeTask,
  understandingQuestionsTask,
  understandingText,
  understandingTextRules,
  wordCount,
} from "../src/tasks/understanding.ts";
import { PLACEHOLDER_NAMES } from "../src/text.ts";

const genre = (id: string) => TEXT_GENRES.find((g) => g.id === id) as (typeof TEXT_GENRES)[number];
const CONVERSATION = genre("conversation");

const TEXT: UnderstandingText = {
  kind: "dialogue",
  title: "В пекарне",
  situation: "Анна покупает булочки.",
  lines: [
    { speaker: "Anna", text: "Guten Morgen! Zwei Brötchen, bitte." },
    { speaker: "Verkäufer", text: "Gern. Das macht 1,20 Euro." },
  ],
  glossary: [{ word: "Brötchen", translation: "булочка" }],
  questions: [
    {
      phase: "listening",
      question: "Anna möchte drei Brötchen.",
      options: ["Richtig", "Falsch"],
      answer: 1,
    },
    { phase: "listening", question: "Wie viel kostet das?", accepted: ["1,20", "1,20 Euro"] },
    {
      phase: "listening",
      question: "Wann ist das?",
      options: ["am Morgen", "am Abend", "in der Nacht"],
      answer: 0,
    },
    {
      phase: "reading",
      question: "Wer verkauft?",
      options: ["Anna", "der Verkäufer", "niemand"],
      answer: 1,
    },
  ],
};

const DRAFT: UnderstandingDraft = {
  title: "В пекарне",
  situation: "Анна утром покупает булочки.",
  people: [
    { name: "Anna", gender: "f", age: "adult", role: "покупательница" },
    { name: "Herr Brandt", gender: "m", age: "senior", role: "пекарь" },
  ],
  beats: ["Анна заходит", "покупает булочки", "платит"],
  facts: ["zwei Brötchen", "1,20 Euro", "am Morgen"],
  text: [
    "Anna: Guten Morgen! Zwei Brötchen, bitte.",
    "**Herr Brandt:** Gern. Möchten Sie auch ein Brot?",
    "Anna: Nein, danke. Was kostet das?",
    "Herr Brandt: Das macht 1,20 Euro. Schönen Tag noch!",
    "Anna: Danke, Ihnen auch. Tschüss!",
    "Herr Brandt: Tschüss, bis morgen!",
  ].join("\n"),
};

/** A model answering with `replies` in order; what it was sent is kept. */
const scripted = (replies: unknown[]) => {
  const sent: string[] = [];
  const client: LlmClient = {
    models: async () => [],
    chat: () => (async function* () {})(),
    complete: async (request) => {
      sent.push(String(request.messages.at(-1)?.content));
      return JSON.stringify(replies.shift());
    },
  };
  return { client, sent };
};

const LESSON = {
  title: "Beim Bäcker",
  goals: ["Einkaufen"],
  vocab: [{ target: "das Brötchen", translation: "булочка" }],
  level: "A1",
  place: { n: 5, of: 40 },
  knownWords: [{ target: "der Morgen", translation: "утро" }],
  topics: [{ title: "Zahlen", lesson: "1.1" }],
  grammarHtml: ["<h2>Akkusativ</h2><p>Ich möchte einen Kaffee.</p>"],
  characters: ["Nico", "Lisa"],
  upcoming: ["Perfekt", "Dativ"],
  scriptHtml: "<p>NICO: Ich hätte gern ein Brötchen.</p>",
};
const INPUT = { language: "ru", target: "de", lesson: LESSON } as const;

test("genres: a step's at the level, picked at random apart from the lesson's last; longer by level and place", () => {
  const a1 = genresFor("listening", "A1").map((g) => g.id);
  expect(a1).toContain("conversation");
  expect(a1).not.toContain("three_people");
  expect(genresFor("listening", "B1").map((g) => g.id)).toContain("three_people");
  expect(genresFor("reading", "A1").every((g) => g.step === "reading")).toBe(true);
  // A course's start (very few words known): the genres made from the first words only.
  expect(genresFor("reading", "A1", true).map((g) => g.id)).toEqual(["chat", "notice"]);
  // Never one of the recent while another is there; any when all are recent.
  const reading = genresFor("reading", "A1").map((g) => g.id);
  for (let i = 0; i < 20; i++) {
    const picked = pickGenre("reading", "A1", reading.slice(1), () => i / 20);
    expect(picked.id).toBe(reading[0] as string);
  }
  expect(reading).toContain(pickGenre("reading", "A1", reading, () => 0.5).id);
  expect(new Set(pickAreas(5, Math.random)).size).toBe(5);
  // Length: the genre's at A1, longer by the level and in the course's last third.
  expect(textWords(CONVERSATION, "A1", "middle")).toEqual([50, 90]);
  expect(textWords(CONVERSATION, "A1", "early")).toEqual([40, 70]);
  expect(textWords(CONVERSATION, "A2", "middle")).toEqual([70, 125]);
  expect(questionCount([40, 70])).toBe(5);
  expect(questionCount([140, 220])).toBe(10);
  // The place: thirds of the course; from A2 on never "early".
  expect(courseThird({ place: { n: 1, of: 40 } })).toBe("early");
  expect(courseThird({ place: { n: 40, of: 40 } })).toBe("late");
  expect(courseThird({})).toBe("middle");
  expect(practiceThird({ place: { n: 1, of: 40 }, level: "A2" })).toBe("middle");
});

test("understanding_draft: the lesson, the grammar met and ahead, its script, the genre, the length and ideas; the rules name no level or language", () => {
  const task = understandingDraftTask({
    ...INPUT,
    genre: CONVERSATION,
    areas: ["a café", "a market"],
    usedNames: ["Herr Keller", "Lena"],
  });
  const request = structuredRequest(task);
  expect(request.jsonSchema?.name).toBe("understanding_draft");
  const [system, data] = request.messages.map((m) => String(m.content));
  for (const line of [
    "Learner's level: A1",
    "Goals: Einkaufen",
    "das Brötchen (булочка)",
    "Grammar met so far: Zahlen",
    "This lesson's grammar:\nAkkusativ",
    "Grammar the course teaches later (not met yet): Perfekt; Dativ",
    "NICO: Ich hätte gern ein Brötchen.",
    "The course's characters: Nico, Lisa",
    `Genre: ${CONVERSATION.what}.`,
    'Form: Write it as lines "Name: what they say"',
    "Length of the text: about 40–70 words.",
    "Ideas for the situation: a café; a market.",
    "The learner knows very few words yet",
    "Names the learner's recent texts used (name the people otherwise, first names and surnames): Herr Keller, Lena.",
  ])
    expect(data).toContain(line);
  expect(system).toContain("Reply with the JSON object only.");
  const template = understandingTextRules("ru", "de", PLACEHOLDER_NAMES);
  expect(template).not.toMatch(/A1|A2|German|Russian|Richtig/);
  for (const rule of [
    "never a character of the course",
    "take its topic, never its plot or its people",
    "one goal is enough",
    "they say or ask only what it needs",
  ])
    expect(template).toContain(rule);
  // Written again: the draft and the judge's problems with it.
  const again = understandingDraftTask({
    ...INPUT,
    genre: CONVERSATION,
    areas: [],
    again: { draft: DRAFT, problems: ['"Ich frage zweimal" makes no sense'] },
  });
  const data2 = String(again.request.messages[1]?.content);
  expect(data2).toContain("<draft>\nTitle: В пекарне");
  expect(data2).toContain('"Ich frage zweimal" makes no sense');
});

test("draftLines: a dialogue's lines by speaker (bold names too), one person's paragraphs said by them, a written text's", () => {
  const { lines, problem } = draftLines(DRAFT, CONVERSATION);
  expect(problem).toBeUndefined();
  expect(lines[1]).toEqual({ speaker: "Herr Brandt", text: "Gern. Möchten Sie auch ein Brot?" });
  expect(wordCount(lines)).toBe(30);
  const stray = { ...DRAFT, text: `${DRAFT.text}\nMax: Und ich?` };
  expect(draftLines(stray, CONVERSATION).problem).toContain('"Name: what they say"');
  const alone = { ...DRAFT, text: "Anna: Hallo!\nAnna: Wo bist du?" };
  expect(draftLines(alone, CONVERSATION).problem).toBe("at least two of the people speak");
  const message = genre("voice_message");
  const one = { ...DRAFT, people: [DRAFT.people[0] as UnderstandingDraft["people"][number]] };
  const said = draftLines({ ...one, text: "Hallo Tom!\n\nRuf mich an." }, message);
  expect(said).toEqual({
    lines: [
      { text: "Hallo Tom!", speaker: "Anna" },
      { text: "Ruf mich an.", speaker: "Anna" },
    ],
  });
  expect(draftLines(DRAFT, message).problem).toBe('one person speaks: one in "people"');
  // A long paragraph (a story's, an article's) as lines of whole sentences: a line is stored up to
  // 600 characters.
  const long = "Tom wohnt in Berlin und arbeitet jeden Tag im Büro. ".repeat(14).trim();
  const story = draftLines({ ...DRAFT, text: long }, genre("story")).lines;
  expect(story.length).toBe(2);
  expect(story.every((l) => l.text.length <= 500)).toBe(true);
  expect(story.map((l) => l.text).join(" ")).toBe(long);
  const turn = draftLines({ ...DRAFT, text: `Anna: ${long}\nHerr Brandt: Aha.` }, CONVERSATION);
  expect(turn.lines.map((l) => l.speaker)).toEqual(["Anna", "Anna", "Herr Brandt"]);
  // A tag carried over from the prompt is dropped.
  expect(
    draftLines({ ...DRAFT, text: "Liebe Anna,\nTschüss!</text>" }, genre("story")).lines,
  ).toEqual([{ text: "Liebe Anna," }, { text: "Tschüss!" }]);
  expect(draftLines({ ...DRAFT, text: "Liebe Anna,\nwie geht's?" }, genre("story")).lines).toEqual([
    { text: "Liebe Anna," },
    { text: "wie geht's?" },
  ]);
});

test("draftProblem: a course character, a title in the learnt language, a length far off — asked again once", async () => {
  const input = { ...INPUT, genre: CONVERSATION, areas: [] };
  expect(draftProblem(DRAFT, input)).toBeUndefined();
  const nico = { ...DRAFT, text: DRAFT.text.replace("Guten Morgen!", "Hallo Nico!") };
  expect(draftProblem(nico, input)).toBe(
    "the people are new, none of the course's characters (Nico)",
  );
  expect(draftProblem({ ...DRAFT, title: "Beim Bäcker", situation: "Anna kauft." }, input)).toBe(
    '"title" and "situation" in Russian',
  );
  const short = { ...DRAFT, text: "Anna: Hallo!\nHerr Brandt: Hallo!" };
  expect(draftProblem(short, input)).toBe("the text about 40–70 words long (it has 2)");
  const model = scripted([nico, DRAFT]);
  expect(await runStructured(model.client, "m", understandingDraftTask(input))).toEqual(DRAFT);
  expect(model.sent[1]).toContain("none of the course's characters (Nico)");
});

const rating = (n: number, r: Partial<DraftRating> = {}): DraftRating => ({
  n,
  gist: "Анна покупает булочки.",
  natural: 4,
  coherent: 4,
  realistic: 4,
  level: 4,
  lesson: 4,
  interest: 3,
  problems: [],
  ...r,
});

test("understanding_judge: the drafts numbered, a rating for each; the best that passes kept, none passing the best written again", async () => {
  const task = understandingJudgeTask({ ...INPUT, genre: CONVERSATION, drafts: [DRAFT, DRAFT] });
  const data = String(task.request.messages[1]?.content);
  expect(data).toContain('<draft n="1">\nTitle: В пекарне');
  expect(data).toContain('<draft n="2">');
  const model = scripted([{ ratings: [rating(1)] }, { ratings: [rating(1), rating(2)] }]);
  await runStructured(model.client, "m", task);
  expect(model.sent[1]).toContain("one rating for each of the 2 drafts");

  expect(chooseDraft([rating(1), rating(2, { interest: 5 })])).toEqual({ index: 1, again: false });
  // A better total that fails (a line that does not follow) loses to one that passes.
  expect(chooseDraft([rating(1, { coherent: 2, interest: 5, lesson: 5 }), rating(2)])).toEqual({
    index: 1,
    again: false,
  });
  expect(chooseDraft([rating(1, { realistic: 2 }), rating(2, { natural: 3 })])).toEqual({
    index: 1,
    again: true,
  });
});

test("understanding_questions: the text, its facts, how many and of which kinds; the text kept with its phase, kind and people", () => {
  const task = understandingQuestionsTask({
    ...INPUT,
    step: "listening",
    text: { lines: draftLines(DRAFT, CONVERSATION).lines },
    facts: DRAFT.facts,
    count: 6,
  });
  expect(structuredRequest(task).jsonSchema?.name).toBe("understanding_questions");
  const data = String(task.request.messages[1]?.content);
  expect(data).toContain("The text is heard");
  expect(data).toContain("Herr Brandt: Das macht 1,20 Euro.");
  expect(data).toContain("<facts>\nzwei Brötchen");
  expect(data).toContain("Questions: 6. Mostly true/false");
  expect(data).toContain('"Richtig" and "Falsch"');
  const asked = {
    questions: [{ question: "Was kostet das?", accepted: ["1,20"] }],
    glossary: [{ word: "Brot", translation: "хлеб" }],
  };
  const text = understandingText("listening", CONVERSATION, DRAFT, asked, {
    ...rating(1),
    drafts: 3,
  });
  expect(text.kind).toBe("dialogue");
  expect(text.step).toBe("listening");
  expect(text.questions).toEqual([
    { question: "Was kostet das?", accepted: ["1,20"], phase: "listening" },
  ]);
  expect(text.people).toEqual([
    { name: "Anna", gender: "f", age: "adult" },
    { name: "Herr Brandt", gender: "m", age: "senior" },
  ]);
  expect(text.rating).toMatchObject({ natural: 4, drafts: 3 });
  expect(understandingText("listening", genre("voice_message"), DRAFT, asked).kind).toBe(
    "announcement",
  );
  expect(understandingText("reading", genre("chat"), DRAFT, asked).kind).toBe("reading");
});

test("understanding_check: the text with its speakers and the questions without their answers; blind, no text", () => {
  const request = structuredRequest(
    understandingCheckTask({ language: "ru", target: "de", text: TEXT }),
  );
  expect(request.jsonSchema?.name).toBe("understanding_check");
  const data = String(request.messages[1]?.content);
  expect(data).toContain("Verkäufer: Gern. Das macht 1,20 Euro.");
  expect(data).toContain("1. Anna möchte drei Brötchen.\n   a) Richtig\n   b) Falsch");
  expect(data).toContain("2. Wie viel kostet das?\n   (answer typed)");
  expect(data).not.toContain('"answer"');
  const blind = String(
    understandingCheckTask({ language: "ru", target: "de", text: TEXT, blind: true }).request
      .messages[1]?.content,
  );
  expect(blind).not.toContain("Verkäufer: Gern.");
  expect(blind).toContain("1. Anna möchte drei Brötchen.");
});

test("settledQuestions: one answered otherwise, ambiguous or left out is dropped, one given away without the text too; an answer typed checked as the learner's", () => {
  const typed: string[] = [];
  const kept = settledQuestions(
    TEXT,
    {
      answers: [
        { n: 1, choice: "B", ambiguous: false },
        { n: 2, answer: "1,20 €", ambiguous: false },
        { n: 3, choice: "a", ambiguous: true },
        // Question 4 not answered.
      ],
    },
    (q, answer) => {
      typed.push(answer);
      return q.accepted?.some((a) => answer.startsWith(a)) ?? false;
    },
  );
  expect(kept.questions.map((q) => q.question)).toEqual([
    "Anna möchte drei Brötchen.",
    "Wie viel kostet das?",
  ]);
  expect(typed).toEqual(["1,20 €"]);
  const wrong = settledQuestions(
    TEXT,
    { answers: [{ n: 1, choice: "a", ambiguous: false }] },
    () => true,
  );
  expect(wrong.questions).toEqual([]);
  // Typed only a number, a price or a time: one typed otherwise is left out, however answered.
  const word = {
    ...TEXT,
    questions: [{ phase: "reading" as const, question: "Wer verkauft?", accepted: ["Verkäufer"] }],
  };
  const none = settledQuestions(
    word,
    { answers: [{ n: 1, answer: "Verkäufer", ambiguous: false }] },
    () => true,
  );
  expect(none.questions).toEqual([]);
  // Without the text: question 3 answered as the key and sure — common sense gives it away.
  const all = {
    answers: [
      { n: 1, choice: "b", ambiguous: false },
      { n: 3, choice: "a", ambiguous: false },
      { n: 4, choice: "b", ambiguous: false },
    ],
  };
  const blind = {
    answers: [
      { n: 1, choice: "b", ambiguous: true },
      { n: 3, choice: "a", ambiguous: false },
      { n: 4, choice: "a", ambiguous: false },
    ],
  };
  expect(settledQuestions(TEXT, all, () => true, blind).questions.map((q) => q.question)).toEqual([
    "Anna möchte drei Brötchen.",
    "Wer verkauft?",
  ]);
});
