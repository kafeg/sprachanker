// Synthetic page states shaped like DW's; no real content.
import { expect, test } from "bun:test";
import { Exercise, exerciseKey, lessonKey } from "@sprachanker/schema";
import { createContext } from "../src/normalise/context.ts";
import { normaliseExercise } from "../src/normalise/exercise.ts";
import { plainLines, plainText } from "../src/normalise/text.ts";
import { parseHeadword } from "../src/normalise/vocab.ts";

test.each([
  ["die Tasse, die Tassen", "", { lemma: "Tasse", pos: "noun", gender: "f", plural: "die Tassen" }],
  [
    "der Tee, die Tees (nach Zahl: Tee)",
    "",
    { lemma: "Tee", pos: "noun", gender: "m", plural: "die Tees", note: "nach Zahl: Tee" },
  ],
  [
    "die Leute (Plural)",
    "nur Plural",
    { lemma: "Leute", pos: "noun", gender: "pl", note: "nur Plural" },
  ],
  [
    "(das) Deutsch",
    "nur Singular",
    { lemma: "Deutsch", pos: "noun", gender: "n", note: "nur Singular" },
  ],
  [
    "(etwas) bestellen",
    "bestellt, bestellte, hat bestellt",
    { lemma: "bestellen", pos: "verb", forms: "bestellt, bestellte, hat bestellt" },
  ],
  [
    "klein",
    "kleiner, am kleinsten",
    { lemma: "klein", pos: "adj", forms: "kleiner, am kleinsten" },
  ],
  ["Ich trinke Tee.", "", { lemma: "Ich trinke Tee.", pos: "phrase" }],
  [
    "Frau",
    "hier nur Singular, ohne Artikel",
    { lemma: "Frau", pos: "word", note: "hier nur Singular, ohne Artikel" },
  ],
])("%s", (name, sub, expected) => {
  expect(parseHeadword(name, sub)).toEqual(expected as never);
});

test("plain text and lines", () => {
  expect(plainText("<p>Guten&nbsp;Tag,&#160;Herr&rsquo;s </p>")).toBe("Guten Tag, Herr’s");
  expect(
    plainText(
      `<p>Ins <span>Zentrum</span> , <b>bitte</b>.</p><p>( Ja )<span>Appetit</span><span>auf</span> ... und</p>`,
    ),
  ).toBe("Ins Zentrum, bitte. (Ja) Appetit auf ... und");
  expect(plainLines("<p>A: #p#.<br />B: Danke!</p><p>C: Gut.</p>")).toBe(
    "A: #p#.\nB: Danke!\nC: Gut.",
  );
});

const ctx = createContext({
  "https://audio.test/q1.mp3": {
    kind: "audio",
    path: "media/audio/q1.mp3",
    sha256: "a".repeat(64),
    size: 1,
    mime: "audio/mpeg",
  },
});
const key = exerciseKey(lessonKey("dw.nicos-weg/a1" as never, 0, 1), 9);
const state = {
  "Exercise:9": {
    id: 9,
    name: "Herr oder Frau?",
    description: "<p>Выбери.</p>",
    inputType: "NONE",
    inquiries: [{ __ref: "Inquiry:1" }, { __ref: "Inquiry:2" }],
  },
  "Inquiry:1": {
    inquiryType: "CLOZE",
    clozeLayoutType: "SINGLE_SENTENCE",
    inquiryText: "Herr oder Frau?",
    inquiryDescription: "<p>Справка: …</p>",
    'contentLinks({"targetTypes":["AUDIO"]})': [{ __ref: "ContentLink:1" }],
    subInquiries: [{ __ref: "Inquiry:11" }],
  },
  "ContentLink:1": { target: { mp3Src: "https://audio.test/q1.mp3" } },
  "Inquiry:11": {
    clozeType: "PULLDOWN",
    inquiryText: "Guten Tag, #p# Weber.",
    alternatives: [{ __ref: "Alt:1" }, { __ref: "Alt:2" }],
  },
  "Alt:1": { alternativeText: "Herr", isCorrect: false },
  "Alt:2": { alternativeText: "Frau", isCorrect: true },
  "Inquiry:2": {
    inquiryType: "CLOZE",
    clozeLayoutType: "SINGLE_SENTENCE",
    inquiryText: "Прослушать аудио",
    subInquiries: [{ __ref: "Inquiry:21" }],
  },
  "Inquiry:21": {
    clozeType: "PULLDOWN",
    inquiryText: "Guten Abend, #p# Kamp.",
    alternatives: [{ __ref: "Alt:1" }, { __ref: "Alt:2" }],
  },
};

test("a pulldown cloze becomes gap_choice; learner texts go to the locale; player labels are dropped", () => {
  const { exercise, locale, unmapped } = normaliseExercise(
    ctx,
    state as never,
    9,
    key,
    "raw/ru-de/a1/e-9.json",
  );
  expect(unmapped).toBeUndefined();
  expect(Exercise.parse(exercise).type).toBe("gap_choice");
  const [first, second] = exercise.items as Array<Record<string, unknown>>;
  expect(first).toMatchObject({
    prompt: "Herr oder Frau?",
    media: { audio: "media/audio/q1.mp3" },
    segments: ["Guten Tag, ", { gap: "g1" }, " Weber."],
    display: "dropdown",
    answer: { g1: "b" },
  });
  expect(second?.prompt).toBeUndefined();
  expect(locale).toEqual({
    sourceId: "9",
    title: "Herr oder Frau?",
    instructionHtml: "<p>Выбери.</p>",
    items: { "#1": { hintHtml: "<p>Справка: …</p>" } },
  });
});

test("an unseen mechanic becomes unknown with a reason", () => {
  const odd = { ...state, "Inquiry:1": { ...state["Inquiry:1"], inquiryType: "PUZZLE" } };
  const { exercise, unmapped } = normaliseExercise(
    ctx,
    odd as never,
    9,
    key,
    "raw/ru-de/a1/e-9.json",
  );
  expect(exercise.type).toBe("unknown");
  expect(unmapped).toBe("inquiry type PUZZLE");
});
