// Canonical content of the fixture course: an invented mini course that uses every exercise type.
// All text here is our own; nothing is copied from a real course.
import { type ExerciseDraft, withFingerprint } from "@sprachanker/course-kit";
import {
  type CourseIndex,
  courseKey,
  type Exam,
  type Exercise,
  examItemKey,
  examKey,
  examSectionKey,
  exerciseKey,
  itemKey,
  type Lesson,
  type LessonKey,
  lessonGoalKey,
  lessonKey,
  lexemeKey,
  ruleId,
  sceneKey,
  seriesKey,
  unitKey,
  type VocabEntry,
  vocabKey,
} from "@sprachanker/schema";
import { audio, image, video } from "./media.ts";

export const SERIES = seriesKey("sprachanker", "fixture");
export const COURSE = courseKey(SERIES, "demo");
export const UNIT = unitKey(COURSE, 0);
export const CAFE = lessonKey(COURSE, 0, 1);
export const SPEAKING = lessonKey(COURSE, 0, 2);
export const EXAM = examKey(COURSE, "mini");
/** A language exam's model test: modules of Teile with their material (Goethe's shape). */
export const MODELL = examKey(COURSE, "modell");

const DU_SIE = ruleId("de", "greeting", "du-sie");
const GENDER = ruleId("de", "noun", "gender");
const PRESENT = ruleId("de", "verb", "present-regular");

/** Builds an exercise with item keys `#1…` and its fingerprint. */
function exercise(
  lesson: LessonKey,
  n: number,
  draft: Omit<ExerciseDraft, "key" | "items" | "newWords" | "ruleIds"> & {
    newWords?: ExerciseDraft["newWords"];
    ruleIds?: ExerciseDraft["ruleIds"];
    items: Array<Record<string, unknown>>;
  },
): Exercise {
  const key = exerciseKey(lesson, n);
  return withFingerprint({
    newWords: [],
    ruleIds: [],
    ...draft,
    key,
    items: draft.items.map((item, i) => ({ key: itemKey(key, i + 1), ...item })),
  } as ExerciseDraft);
}

const vocab = (lesson: LessonKey, entry: Omit<VocabEntry, "key">, lemma: string): VocabEntry => ({
  key: vocabKey(lesson, lemma),
  ...entry,
});

const KAFFEE = vocab(
  CAFE,
  {
    lexeme: lexemeKey("de", "Kaffee", "noun", "m"),
    target: "der Kaffee, die Kaffees",
    gender: "m",
    plural: "die Kaffees",
    audio: audio("kaffee"),
  },
  "Kaffee",
);
const TASSE = vocab(
  CAFE,
  {
    lexeme: lexemeKey("de", "Tasse", "noun", "f"),
    target: "die Tasse, die Tassen",
    gender: "f",
    plural: "die Tassen",
    image: image("tasse"),
    audio: audio("tasse"),
  },
  "Tasse",
);
const BESTELLEN = vocab(
  CAFE,
  {
    lexeme: lexemeKey("de", "bestellen", "verb"),
    target: "(etwas) bestellen",
    forms: "bestellt, bestellte, hat bestellt",
  },
  "bestellen",
);
const GERN = vocab(CAFE, { lexeme: lexemeKey("de", "gern", "word"), target: "gern" }, "gern");
const GUTEN_TAG = vocab(
  SPEAKING,
  { lexeme: lexemeKey("de", "Guten Tag.", "phrase"), target: "Guten Tag." },
  "Guten Tag",
);
const LEUTE = vocab(
  SPEAKING,
  {
    lexeme: lexemeKey("de", "Leute", "noun", "pl"),
    target: "die Leute (Plural)",
    gender: "pl",
    note: "nur Plural",
  },
  "Leute",
);

export const cafeLesson: Lesson = {
  format: 1,
  key: CAFE,
  unit: UNIT,
  media: { video: { sd: video("cafe-sd"), hd: video("cafe-hd") }, image: image("cafe") },
  goals: [lessonGoalKey(CAFE, 1)],
  pages: [
    exercise(CAFE, 1, {
      type: "single_choice",
      media: { video: video("cafe-sd") },
      items: [
        {
          prompt: "Wo ist Lena?",
          // The answer, spoken: offered once the item is checked.
          answerAudio: audio("im-cafe"),
          options: [
            { id: "a", text: "Im Café." },
            { id: "b", text: "Im Park." },
          ],
          answer: { optionIds: ["a"] },
        },
        {
          options: [
            { id: "a", media: { image: image("lena") } },
            { id: "b", media: { image: image("tom") } },
          ],
          answer: { optionIds: ["b"] },
        },
      ],
    }),
    exercise(CAFE, 2, {
      type: "multi_choice",
      newWords: [KAFFEE.key],
      items: [
        {
          prompt: "Was bestellt Tom?",
          media: { audio: audio("tom-bestellt") },
          options: [
            { id: "a", text: "einen Kaffee" },
            { id: "b", text: "einen Tee" },
            { id: "c", text: "einen Kuchen" },
            { id: "d", text: "ein Wasser" },
          ],
          answer: { optionIds: ["a", "c"] },
        },
      ],
    }),
    exercise(CAFE, 3, {
      type: "match",
      newWords: [TASSE.key],
      ruleIds: [GENDER],
      items: [
        {
          prompt: "Was passt zusammen?",
          left: [
            { id: "a", text: "die Tasse" },
            { id: "b", text: "der Kuchen" },
          ],
          right: [
            { id: "a", media: { image: image("kuchen") } },
            { id: "b", media: { image: image("tasse") } },
          ],
          answer: {
            pairs: [
              ["a", "b"],
              ["b", "a"],
            ],
          },
        },
      ],
    }),
    exercise(CAFE, 4, {
      type: "order",
      newWords: [GERN.key],
      ruleIds: [PRESENT],
      items: [
        {
          media: { audio: audio("ich-trinke-gern-tee") },
          parts: [
            { id: "a", text: "Ich" },
            { id: "b", text: "trinke" },
            { id: "c", text: "gern" },
            { id: "d", text: "Tee." },
          ],
          join: "space",
          answer: { sequence: ["a", "b", "c", "d"] },
        },
      ],
    }),
    exercise(CAFE, 5, {
      type: "order",
      items: [
        {
          media: { image: image("tasse") },
          parts: [
            { id: "a", text: "T" },
            { id: "b", text: "a" },
            { id: "c", text: "s" },
            { id: "d", text: "s" },
            { id: "e", text: "e" },
          ],
          join: "none",
          answer: { sequence: ["a", "b", "c", "d", "e"] },
        },
      ],
    }),
    exercise(CAFE, 6, {
      type: "gap_choice",
      ruleIds: [DU_SIE],
      items: [
        {
          prompt: "Herr oder Frau?",
          media: { image: image("frau-weber") },
          segments: ["Guten Tag, ", { gap: "g1" }, " Weber."],
          gaps: {
            g1: {
              options: [
                { id: "a", text: "Herr" },
                { id: "b", text: "Frau" },
              ],
            },
          },
          display: "dropdown",
          answer: { g1: "b" },
        },
      ],
    }),
    exercise(CAFE, 7, {
      type: "gap_choice",
      newWords: [BESTELLEN.key],
      ruleIds: [PRESENT],
      items: [
        {
          segments: ["Ich ", { gap: "g1" }, " Lena. Ich ", { gap: "g2" }, " einen Kaffee."],
          gaps: {
            g1: {
              options: [
                { id: "a", text: "heiße" },
                { id: "b", text: "bestelle" },
              ],
            },
            g2: {
              options: [
                { id: "a", text: "heiße" },
                { id: "b", text: "bestelle" },
              ],
            },
          },
          display: "bank",
          answer: { g1: "a", g2: "b" },
        },
      ],
    }),
    exercise(CAFE, 8, {
      type: "gap_text",
      ruleIds: [GENDER],
      items: [
        {
          media: { audio: audio("ein-kaffee-bitte") },
          segments: ["Einen ", { gap: "g1" }, ", bitte. Mit ", { gap: "g2" }, "?"],
          answer: { g1: { accepted: ["Kaffee"] }, g2: { accepted: ["Milch", "Zucker"] } },
        },
      ],
    }),
  ].map((ex) => ({ exercise: ex })),
  vocab: [KAFFEE, TASSE, BESTELLEN, GERN],
  unmapped: [],
};

export const speakingLesson: Lesson = {
  format: 1,
  key: SPEAKING,
  unit: UNIT,
  media: { audio: audio("guten-morgen") },
  goals: [lessonGoalKey(SPEAKING, 1)],
  pages: [
    exercise(SPEAKING, 1, {
      type: "dictation",
      items: [
        {
          media: { audio: audio("ich-trinke-tee") },
          answer: { accepted: ["Ich trinke Tee."] },
        },
      ],
    }),
    exercise(SPEAKING, 2, {
      type: "speech_selfrate",
      newWords: [GUTEN_TAG.key],
      items: [
        { text: "Guten Tag!", media: { audio: audio("guten-tag") } },
        { answerAudio: audio("hallo-guten-tag") },
      ],
    }),
    exercise(SPEAKING, 3, {
      type: "speech_repeat",
      ruleIds: [DU_SIE],
      items: [{ text: "Wie geht es Ihnen?", media: { audio: audio("wie-geht-es-ihnen") } }],
    }),
    exercise(SPEAKING, 4, {
      type: "respond",
      items: [
        {
          input: "text",
          rubric: {
            required: [{ id: "drink", anyOf: ["Kaffee", "Tee"] }],
            criteria: [{ id: "polite" }],
          },
          reference: ["Einen Kaffee, bitte.", "Ich hätte gern einen Tee."],
        },
      ],
    }),
    exercise(SPEAKING, 5, {
      type: "scene",
      newWords: [LEUTE.key],
      items: [{ scene: sceneKey(SERIES, "cafe-order") }],
    }),
    exercise(SPEAKING, 6, {
      type: "unknown",
      items: [{ raw: "raw/ru-de/demo/00-02/ex-06.json", reason: "fixture: unmapped source type" }],
    }),
  ].map((ex) => ({ exercise: ex })),
  vocab: [GUTEN_TAG, LEUTE],
  unmapped: [{ path: "raw/ru-de/demo/00-02/extra.json", reason: "fixture: unmapped page" }],
};

export const miniExam: Exam = {
  format: 1,
  key: EXAM,
  timeLimitSec: 300,
  sections: [
    {
      key: examSectionKey(EXAM, "general"),
      pool: [examItemKey(EXAM, "001"), examItemKey(EXAM, "002")],
      draw: 2,
      filter: null,
    },
    {
      key: examSectionKey(EXAM, "state"),
      pool: [examItemKey(EXAM, "be-01"), examItemKey(EXAM, "by-01")],
      draw: 1,
      filter: { tag: "federalState", setting: "exam.federalState" },
    },
  ],
  items: [
    {
      key: examItemKey(EXAM, "001"),
      type: "single_choice",
      tags: { federalState: null },
      prompt: "Wie viele Tage hat eine Woche?",
      options: [
        { id: "a", text: "fünf" },
        { id: "b", text: "sieben" },
      ],
      answer: { optionIds: ["b"] },
    },
    {
      key: examItemKey(EXAM, "002"),
      type: "single_choice",
      tags: { federalState: null },
      prompt: "Welches Bild zeigt eine Tasse?",
      options: [
        { id: "a", media: { image: image("tasse") } },
        { id: "b", media: { image: image("kuchen") } },
      ],
      answer: { optionIds: ["a"] },
    },
    {
      key: examItemKey(EXAM, "be-01"),
      type: "single_choice",
      tags: { federalState: "be" },
      prompt: "Welche Farbe hat das Café im Bild?",
      media: { image: image("cafe") },
      options: [
        { id: "a", text: "rot" },
        { id: "b", text: "blau" },
      ],
      answer: { optionIds: ["a"] },
    },
    {
      key: examItemKey(EXAM, "by-01"),
      type: "single_choice",
      tags: { federalState: "by" },
      prompt: "Was trinkt Lena?",
      options: [
        { id: "a", text: "Tee" },
        { id: "b", text: "Kaffee" },
      ],
      answer: { optionIds: ["a"] },
    },
  ],
  thresholds: [
    { id: "pass", minPoints: 2 },
    { id: "excellent", minPoints: 3 },
  ],
};

const choiceOf = (...texts: string[]) =>
  texts.map((text, i) => ({ id: "abcdefgh"[i] as string, text }));
const modellItem = (id: string, rest: Record<string, unknown>) =>
  ({ key: examItemKey(MODELL, id), tags: {}, ...rest }) as Exam["items"][number];

export const modellExam: Exam = {
  format: 1,
  key: MODELL,
  timeLimitSec: 360,
  modules: [
    { id: "hoeren", timeLimitSec: 120, scaleTo: 25 },
    { id: "lesen", timeLimitSec: 180, scaleTo: 25 },
    { id: "schreiben", timeLimitSec: 60, scaleTo: 25 },
  ],
  sections: [
    {
      key: examSectionKey(MODELL, "h1"),
      module: "hoeren",
      pool: [examItemKey(MODELL, "h1"), examItemKey(MODELL, "h2")],
      draw: 2,
      filter: null,
      plays: 2,
      example: examItemKey(MODELL, "h0"),
    },
    {
      key: examSectionKey(MODELL, "h2"),
      module: "hoeren",
      pool: [examItemKey(MODELL, "h3")],
      draw: 1,
      filter: null,
      media: { audio: audio("im-cafe") },
      plays: 1,
    },
    {
      key: examSectionKey(MODELL, "l1"),
      module: "lesen",
      pool: [examItemKey(MODELL, "l1"), examItemKey(MODELL, "l2")],
      draw: 2,
      filter: null,
      text: "Liebe Lena,\n\nich komme am Sonntag um drei Uhr ins Café. Bis dann!\n\nTom",
    },
    {
      key: examSectionKey(MODELL, "l2"),
      module: "lesen",
      pool: [examItemKey(MODELL, "l3")],
      draw: 1,
      filter: null,
      text: "a  Café Weber: Kuchen und Kaffee\n\nb  Teeladen am Markt: Tee aus aller Welt",
    },
    {
      key: examSectionKey(MODELL, "s1"),
      module: "schreiben",
      pool: [examItemKey(MODELL, "s1"), examItemKey(MODELL, "s2")],
      draw: 2,
      filter: null,
      media: { image: image("tom") },
    },
  ],
  items: [
    modellItem("h0", {
      type: "single_choice",
      prompt: "Was bestellt Lena?",
      media: { audio: audio("ein-kaffee-bitte") },
      options: choiceOf("einen Kaffee", "einen Tee"),
      answer: { optionIds: ["a"] },
    }),
    modellItem("h1", {
      type: "single_choice",
      prompt: "Was bestellt Tom?",
      media: { audio: audio("tom-bestellt") },
      options: [
        { id: "a", text: "Kaffee", media: { image: image("tasse") } },
        { id: "b", text: "Kuchen", media: { image: image("kuchen") } },
      ],
      answer: { optionIds: ["a"] },
    }),
    modellItem("h2", {
      type: "single_choice",
      prompt: "Was trinkt Lena gern?",
      media: { audio: audio("ich-trinke-gern-tee") },
      options: choiceOf("Tee", "Kaffee", "Wasser"),
      answer: { optionIds: ["a"] },
    }),
    modellItem("h3", {
      type: "single_choice",
      prompt: "Tom und Lena sind im Café.",
      options: choiceOf("Richtig", "Falsch"),
      answer: { optionIds: ["a"] },
    }),
    modellItem("l1", {
      type: "single_choice",
      prompt: "Tom kommt am Montag.",
      options: choiceOf("Richtig", "Falsch"),
      answer: { optionIds: ["b"] },
    }),
    modellItem("l2", {
      type: "single_choice",
      prompt: "Wann kommt Tom?",
      options: choiceOf("um zwei Uhr", "um drei Uhr"),
      answer: { optionIds: ["b"] },
    }),
    modellItem("l3", {
      type: "single_choice",
      prompt: "Sie möchten Tee kaufen.",
      options: choiceOf("a", "b", "0"),
      answer: { optionIds: ["b"] },
    }),
    modellItem("s1", {
      type: "gap_text",
      segments: ["Name: ", { gap: "g1" }],
      answer: { g1: { accepted: ["Tom Weber"] } },
    }),
    modellItem("s2", {
      type: "gap_text",
      segments: ["Getränk: ", { gap: "g1" }],
      answer: { g1: { accepted: ["Kaffee", "ein Kaffee"] } },
    }),
  ],
  thresholds: [
    { id: "pass", minPoints: 45 },
    { id: "written", minPoints: 10, modules: ["schreiben"] },
  ],
  passWhen: "all",
};

export const courseIndex: CourseIndex = {
  format: 1,
  key: COURSE,
  units: [{ key: UNIT, lessons: [CAFE, SPEAKING] }],
  exams: [EXAM, MODELL],
  goals: [
    { key: lessonGoalKey(CAFE, 1), lessons: [CAFE] },
    { key: lessonGoalKey(SPEAKING, 1), lessons: [SPEAKING] },
  ],
};

export const lessons = [cafeLesson, speakingLesson];
export const exams = [miniExam, modellExam];
export const examItems = miniExam.items;
