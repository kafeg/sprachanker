// Synthetic page states shaped like DW's; no real content.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKeyMap } from "@sprachanker/course-kit";
import { Exercise, exerciseKey, lessonKey, unitKey } from "@sprachanker/schema";
import { createContext, html } from "../src/normalise/context.ts";
import { normaliseExercise } from "../src/normalise/exercise.ts";
import { normaliseLesson, topicParts } from "../src/normalise/lesson.ts";
import { plain, writtenOrder } from "../src/normalise/text.ts";
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

const ctx = createContext(
  {
    "https://audio.test/q1.mp3": {
      kind: "audio",
      path: "media/audio/q1.mp3",
      sha256: "a".repeat(64),
      size: 1,
      mime: "audio/mpeg",
    },
  },
  "ru-de",
);
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

test("a player label in any edition's language is dropped: the page's own interface strings name it", () => {
  const turkish = {
    ...state,
    ROOT_QUERY: {
      'i18nByLang({"lang":"TURKISH"})': {
        all: JSON.stringify({ exercise: { playAudio: "Sesi dinle" } }),
      },
    },
    "Inquiry:2": { ...state["Inquiry:2"], inquiryText: "Sesi dinle" },
  };
  const { exercise } = normaliseExercise(ctx, turkish as never, 9, key, "raw/tr-de/a1/e-9.json");
  expect((exercise.items as Array<Record<string, unknown>>)[1]?.prompt).toBeUndefined();
});

test("a speaking item keeps its spoken answer (the link besides the question) for after the try", () => {
  const audio = (name: string) => ({
    kind: "audio" as const,
    path: `media/audio/${name}.mp3` as never,
    sha256: "a".repeat(64),
    size: 1,
    mime: "audio/mpeg",
  });
  const withAnswer = createContext(
    {
      "https://audio.test/q.mp3": audio("q"),
      "https://audio.test/a.mp3": audio("a"),
    },
    "ru-de",
  );
  const speaking = {
    "Exercise:9": { id: 9, name: "Sprich", inputType: "NONE", inquiries: [{ __ref: "Inquiry:1" }] },
    "Inquiry:1": {
      inquiryType: "REPEAT",
      inquiryText: "",
      'contentLinks({"targetTypes":["AUDIO"]})': [
        { __ref: "ContentLink:1" },
        { __ref: "ContentLink:2" },
      ],
      subInquiries: [{ __ref: "Inquiry:11" }],
    },
    "ContentLink:1": { mainContent: true, target: { mp3Src: "https://audio.test/q.mp3" } },
    "ContentLink:2": { mainContent: false, target: { mp3Src: "https://audio.test/a.mp3" } },
    "Inquiry:11": { inquiryText: "Play audio", inquiryDescription: "Ja, ich ... / Nein, ich ..." },
  };
  const { exercise, locale } = normaliseExercise(
    withAnswer,
    speaking as never,
    9,
    key,
    "raw/en-de/a1/e-9.json",
  );
  expect(Exercise.parse(exercise).items[0]).toEqual({
    key: `${key}#1`,
    media: { audio: "media/audio/q.mp3" },
    answerAudio: "media/audio/a.mp3",
  } as never);
  expect(locale.items["#1"]?.prompt).toBe("Ja, ich ... / Nein, ich ...");
});

test("an item whose only recording is not main content (DW's Lösungsaudio) keeps it as its spoken answer, not its question", () => {
  const solution = createContext(
    {
      "https://audio.test/a.mp3": {
        kind: "audio",
        path: "media/audio/a.mp3" as never,
        sha256: "a".repeat(64),
        size: 1,
        mime: "audio/mpeg",
      },
    },
    "ru-de",
  );
  const choice = {
    "Exercise:9": { id: 9, name: "Wähle", inputType: "NONE", inquiries: [{ __ref: "Inquiry:1" }] },
    "Inquiry:1": {
      inquiryType: "ASSOCIATION",
      selectionType: "SINGLE",
      inquiryText: "Wie geht's?",
      'contentLinks({"targetTypes":["AUDIO"]})': [{ __ref: "ContentLink:2" }],
      subInquiries: [{ __ref: "Inquiry:11" }],
    },
    "ContentLink:2": { mainContent: false, target: { mp3Src: "https://audio.test/a.mp3" } },
    "Inquiry:11": {
      alternatives: [{ __ref: "Alternative:1" }, { __ref: "Alternative:2" }],
    },
    "Alternative:1": { alternativeText: "Gut.", isCorrect: true },
    "Alternative:2": { alternativeText: "Danke.", isCorrect: false },
  };
  const { exercise, unmapped } = normaliseExercise(
    solution,
    choice as never,
    9,
    key,
    "raw/ru-de/a1/e-9.json",
  );
  expect(unmapped).toBeUndefined();
  const [item] = Exercise.parse(exercise).items as Array<Record<string, unknown>>;
  expect(item?.media).toBeUndefined();
  expect(item?.answerAudio).toBe("media/audio/a.mp3");
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

test("a gap without a correct option becomes unknown, not a gap no answer fits; no name, no title", () => {
  const broken = {
    ...state,
    "Exercise:9": { ...state["Exercise:9"], name: "" },
    "Alt:2": { alternativeText: "Frau", isCorrect: false },
  };
  const { exercise, locale, unmapped } = normaliseExercise(
    ctx,
    broken as never,
    9,
    key,
    "raw/ru-de/a1/e-9.json",
  );
  expect([exercise.type, unmapped]).toEqual(["unknown", "gap g1 without a correct option"]);
  expect(locale).not.toHaveProperty("title");
});

test("a lesson's own recording becomes media.audio (Deutschtrainer)", () => {
  const lesson = lessonKey("dw.deutschtrainer/a1-a2" as never, 0, 1);
  const out = normaliseLesson(ctx, {
    key: lesson,
    unit: unitKey("dw.deutschtrainer/a1-a2" as never, 0),
    sourceId: 5,
    edition: "ru-de",
    rawDir: "raw/ru-de/a1-a2",
    lesson: {
      "Lesson:5": {
        id: 5,
        name: "Знакомство",
        audios: [{ __ref: "Audio:7" }],
        videos: [],
        contentLinks: [],
      },
      "Audio:7": { mp3Src: "https://audio.test/q1.mp3" },
    },
    downloads: {},
    exercises: new Map(),
    exerciseNumber: (_occurrence: string, position: number) => position,
  });
  expect(out.lesson.media).toEqual({ audio: "media/audio/q1.mp3" });
});

test("grammar pages: a topic's parts in a lesson are one page; a topic begun earlier keeps its part", () => {
  const page = (title: string, body: string) => ({ sourceId: "1", title, bodyHtml: body });
  expect(
    topicParts([
      page("Topic A (1)", "<p>a1</p>"),
      page("Other", "<p>o</p>"),
      page("Topic A (2)", "<p>a2</p>"),
      page("Topic B (2)", "<p>b2</p>"),
      page("Same", "<p>s1</p>"),
      page("Same", "<p>s2</p>"),
    ]),
  ).toEqual([
    { sourceId: "1", title: "Topic A", bodyHtml: "<p>a1</p><p>a2</p>" },
    { sourceId: "1", title: "Other", bodyHtml: "<p>o</p>" },
    { sourceId: "1", title: "Topic B", bodyHtml: "<p>b2</p>", part: 2 },
    { sourceId: "1", title: "Same", bodyHtml: "<p>s1</p><p>s2</p>" },
  ]);
});

test("parts numbered in the edition's own digits are joined too (Persian, Hindi)", () => {
  const page = (title: string, body: string) => ({ sourceId: "1", title, bodyHtml: body });
  expect(
    topicParts([
      page("وجه مجهول (۱)", "<p>1</p>"),
      page("وجه مجهول (۲)", "<p>2</p>"),
      page("صرف صفت (۳)", "<p>3</p>"),
      page("कर्मवाच्य (२)", "<p>h</p>"),
    ]),
  ).toEqual([
    { sourceId: "1", title: "وجه مجهول", bodyHtml: "<p>1</p><p>2</p>" },
    { sourceId: "1", title: "صرف صفت", bodyHtml: "<p>3</p>", part: 3 },
    { sourceId: "1", title: "कर्मवाच्य", bodyHtml: "<p>h</p>", part: 2 },
  ]);
});

test("parts in full-width brackets, or titled with full-width colons and spaces apart, are joined (Chinese)", () => {
  const page = (title: string, body: string) => ({ sourceId: "1", title, bodyHtml: body });
  expect(
    topicParts([
      page("被动态 （1）", "<p>1</p>"),
      page("被动态（2）", "<p>2</p>"),
      page("第二虚拟式：请求（1）", "<p>a</p>"),
      page("第二虚拟式: 请求（2）", "<p>b</p>"),
      page("形容词变格（3）", "<p>c</p>"),
    ]),
  ).toEqual([
    { sourceId: "1", title: "被动态", bodyHtml: "<p>1</p><p>2</p>" },
    { sourceId: "1", title: "第二虚拟式：请求", bodyHtml: "<p>a</p><p>b</p>" },
    { sourceId: "1", title: "形容词变格", bodyHtml: "<p>c</p>", part: 3 },
  ]);
});

test("a grammar page's bold-only lines become its section titles", () => {
  const lesson = lessonKey("dw.nicos-weg/a1" as never, 0, 1);
  const out = normaliseLesson(ctx, {
    key: lesson,
    unit: unitKey("dw.nicos-weg/a1" as never, 0),
    sourceId: 5,
    edition: "ru-de",
    rawDir: "raw/ru-de/a1",
    lesson: {
      "Lesson:5": {
        id: 5,
        name: "Hallo!",
        videos: [],
        contentLinks: [],
        overviewParts: [{ lessonPart: "GRAMMAR", targetId: 3 }],
      },
      "Knowledge:3": {
        id: 3,
        name: "Приветствие",
        text: "<p><strong>Неформальное</strong></p><p><em>Hallo!</em></p><p><strong>Формальное:</strong></p><p>Guten Tag!</p>",
      },
    },
    downloads: {},
    exercises: new Map(),
    exerciseNumber: (_occurrence: string, position: number) => position,
  });
  expect(out.locale.tabs.grammar).toEqual([
    {
      sourceId: "3",
      title: "Приветствие",
      bodyHtml: "<h3>Неформальное</h3><p><em>Hallo!</em></p><h3>Формальное</h3><p>Guten Tag!</p>",
    },
  ]);
});

test("an exercise page gone at the source, or without its exercise, is left out and reported; the others keep their keys", () => {
  const lesson = lessonKey("dw.nicos-weg/a1-tr" as never, 0, 1);
  const out = normaliseLesson(ctx, {
    key: lesson,
    unit: unitKey("dw.nicos-weg/a1-tr" as never, 0),
    sourceId: 5,
    edition: "tr-de",
    rawDir: "raw/tr-de/a1",
    lesson: {
      "Lesson:5": {
        id: 5,
        name: "Hallo!",
        videos: [],
        contentLinks: [],
        overviewParts: [
          { lessonPart: "EXERCISE", targetId: 8 },
          { lessonPart: "EXERCISE", targetId: 9 },
          { lessonPart: "EXERCISE", targetId: 10 },
        ],
      },
    },
    downloads: {},
    exercises: new Map([
      [9, state as never],
      [10, {} as never],
    ]),
    exerciseNumber: (_occurrence: string, position: number) => position,
  });
  expect(out.lesson.pages.map((p) => ("exercise" in p ? String(p.exercise.key) : ""))).toEqual([
    `${lesson}/ex-02`,
  ]);
  expect(out.lesson.unmapped).toContainEqual({
    path: "raw/tr-de/a1/e-10.json",
    reason: "exercise not in its page at the source",
  });
  expect(out.lesson.unmapped).toContainEqual({
    path: "raw/tr-de/a1/e-8.json",
    reason: "exercise page gone at the source",
  });
});

test("an exercise keeps its key by its source id when the source inserts one before it; a missing page keeps its number, a repeat has its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sprachanker-keys-"));
  const lesson = lessonKey("dw.nicos-weg/a1" as never, 0, 1);
  const keysOf = async (ids: number[], missing: number[] = []) => {
    const keys = await openKeyMap(dir);
    const out = normaliseLesson(ctx, {
      key: lesson,
      unit: unitKey("dw.nicos-weg/a1" as never, 0),
      sourceId: 5,
      edition: "ru-de",
      rawDir: "raw/ru-de/a1",
      lesson: {
        "Lesson:5": {
          id: 5,
          name: "Hallo!",
          videos: [],
          contentLinks: [],
          overviewParts: ids.map((id) => ({ lessonPart: "EXERCISE", targetId: id })),
        },
      },
      downloads: {},
      exercises: new Map(
        ids
          .filter((id) => !missing.includes(id))
          .map((id) => [id, { ...state, [`Exercise:${id}`]: state["Exercise:9"] }]),
      ),
      exerciseNumber: (occurrence, position) => keys.number(lesson, occurrence, position),
    });
    await keys.save();
    return out.lesson.pages.map((p) => ("exercise" in p ? String(p.exercise.key).slice(-5) : ""));
  };
  expect(await keysOf([9, 10])).toEqual(["ex-01", "ex-02"]);
  // A new exercise first: the two keep theirs, it takes the next free number.
  expect(await keysOf([7, 9, 10])).toEqual(["ex-03", "ex-01", "ex-02"]);
  // A page missing the first time it is listed still takes its place's number: when it comes, the
  // number is its own and no other key moved for it.
  expect(await keysOf([7, 9, 10, 11, 12], [11])).toEqual(["ex-03", "ex-01", "ex-02", "ex-05"]);
  expect(await keysOf([7, 9, 10, 11, 12])).toEqual(["ex-03", "ex-01", "ex-02", "ex-04", "ex-05"]);
  // Listed twice: two exercises, two keys.
  expect(await keysOf([7, 9, 10, 11, 12, 9])).toEqual([
    "ex-03",
    "ex-01",
    "ex-02",
    "ex-04",
    "ex-05",
    "ex-06",
  ]);
});

test("a question on the text in the learner's language: its prompt and options go to the locale file", () => {
  const page = {
    "Exercise:7": {
      id: 7,
      name: "Wie gut kennen sie sich?",
      inputType: "NONE",
      inquiries: [{ __ref: "Inquiry:70" }, { __ref: "Inquiry:80" }],
    },
    "Inquiry:70": {
      inquiryType: "ASSOCIATION",
      selectionType: "SINGLE",
      inquiryText: "Лиза и Керстин…",
      subInquiries: [{ __ref: "Inquiry:71" }],
    },
    "Inquiry:71": { alternatives: [{ __ref: "Alt:71" }, { __ref: "Alt:72" }] },
    "Alt:71": { alternativeText: "возможно, не так хорошо знакомы.", isCorrect: true },
    "Alt:72": { alternativeText: "хорошо знакомы.", isCorrect: false },
    "Inquiry:80": {
      inquiryType: "ASSOCIATION",
      selectionType: "SINGLE",
      inquiryText: "Wie heißt sie?",
      subInquiries: [{ __ref: "Inquiry:81" }],
    },
    "Inquiry:81": { alternatives: [{ __ref: "Alt:81" }, { __ref: "Alt:82" }] },
    "Alt:81": { alternativeText: "Lisa", isCorrect: true },
    "Alt:82": { alternativeText: "Kerstin", isCorrect: false },
  };
  const { exercise, locale } = normaliseExercise(ctx, page as never, 7, key, "raw/e-7.json");
  const [russian, german] = exercise.items as Array<{ prompt?: string; options: unknown[] }>;
  expect(russian).toMatchObject({ options: [{ id: "a" }, { id: "b" }] });
  expect(russian?.prompt).toBeUndefined();
  expect(locale.items["#1"]).toEqual({
    prompt: "Лиза и Керстин…",
    options: { a: "возможно, не так хорошо знакомы.", b: "хорошо знакомы." },
  });
  // German stays where it is.
  expect(german).toMatchObject({
    prompt: "Wie heißt sie?",
    options: [
      { id: "a", text: "Lisa" },
      { id: "b", text: "Kerstin" },
    ],
  });
  expect(locale.items["#2"]).toBeUndefined();
});

test.each([
  ["?Was trinkst du", "Was trinkst du?"],
  ["!(Ich mag (nicht", "Ich mag (nicht)!"],
  ["?... Was passiert, wenn", "Was passiert, wenn ...?"],
  ["… Ich habe kein", "Ich habe kein …"],
  ["?Varianten: Wie geht's? / Wie geht's dir", "Varianten: Wie geht's? / Wie geht's dir?"],
  // As written already: a continuation that ends in its own punctuation, a learner-language text.
  ["… um 6 mit Nina.", "… um 6 mit Nina."],
  ["Was trinkst du?", "Was trinkst du?"],
  [".با نه پاسخ بده", "با نه پاسخ بده."],
  ["؟چی می‌نوشی", "چی می‌نوشی؟"],
  ["(etwas) studieren", "(etwas) studieren"],
  ["(البيرة) صبَّ من البرميل", "(البيرة) صبَّ من البرميل"],
])("a text a right-to-left edition keeps as seen is read as written: %p", (seen, written) => {
  expect(writtenOrder(seen)).toBe(written);
});

test("only right-to-left editions are read that way: elsewhere a leading run is the text's own", () => {
  expect(createContext({}, "fa-de").written("?Was trinkst du")).toBe("Was trinkst du?");
  expect(createContext({}, "ru-de").written("… kommt")).toBe("… kommt");
});

const chip = (word: string) =>
  `<span class="editable placeholder" data-id="1" data-type="VOCABULARY">${word}</span>`;
const wrapped = (inner: string) => `<span class="invalid_placeholder">${inner}</span>`;
const titled = (title: string, word: string) =>
  `<span class="editable placeholder" data-title="${title}" data-type="VOCABULARY">${word}</span>`;

test.each([
  [`<p>Wir ${wrapped(chip("lernen"))}Deutsch.</p>`, "<p>Wir lernen Deutsch.</p>"],
  [`<p>Wir machen eine${chip("Pause")} .</p>`, "<p>Wir machen eine Pause.</p>"],
  [
    `<p>Wir ${wrapped(`${chip("hören")}&nbsp;`)}${chip("&nbsp;Bilder")}.</p>`,
    "<p>Wir hören Bilder.</p>",
  ],
  [`<p>${chip("Haus")}${chip("Tür")}</p>`, "<p>Haus Tür</p>"],
  [`<p>Betreff: ${wrapped(chip("Reise"))}&ndash; Nina</p>`, "<p>Betreff: Reise – Nina</p>"],
  [`<p>Mann:${chip("Hallo")}, &quot;${chip("Tag")}&quot;</p>`, `<p>Mann: Hallo, "Tag"</p>`],
  [`<p>(${chip("Tisch")}), „${chip("Stuhl")}“</p>`, "<p>(Tisch), „Stuhl“</p>"],
  // Not inside a word: a compound's tail (its headword a noun), a word's beginning.
  [
    `<p>Viele Winter${titled("der Mantel, die Mäntel", "mäntel")}.</p>`,
    "<p>Viele Wintermäntel.</p>",
  ],
  [`<p>Schon ${titled("wieder", "wiede")}r da.</p>`, "<p>Schon wieder da.</p>"],
  [`<p>Wann${titled("beginnen", "beginnt")} er?</p>`, "<p>Wann beginnt er?</p>"],
  // A noun chip on a compound's head: the tail stays on it; a short word or a verb after a noun
  // chip is a word of its own.
  [`<p>Ich esse ${wrapped(chip("Kalb"))}braten.</p>`, "<p>Ich esse Kalbbraten.</p>"],
  [
    `<p>Das ${chip("Brot")}isst er, das ${chip("Dorf")}kommt.</p>`,
    "<p>Das Brot isst er, das Dorf kommt.</p>",
  ],
  [`<p>Am ${chip("Montag&nbsp;")}gehe ich.</p>`, "<p>Am Montag gehe ich.</p>"],
])("a vocabulary chip is kept apart from the words it meets: %p", (source, expected) => {
  expect(html(ctx, source)).toBe(expected);
  // Plain text (prompts, options, cloze texts) reads them so too (tags there are spaces: straight
  // quotes around a chip are not its concern).
  if (!source.includes("&quot;")) expect(plain(source)).toBe(expected.replace(/<\/?p>/g, ""));
});

test("course HTML is spaced as written: one space, none before marks or inside quotes, none at a block's edges", () => {
  expect(html(ctx, "<p> Посмотри  видео .&nbsp; Отвечай: „ ja “ (  nein ) ... </p>")).toBe(
    "<p>Посмотри видео. Отвечай: „ja“ (nein) ...</p>",
  );
  // French keeps its space before two-part marks.
  expect(html(createContext({}, "fr-de"), "<p>Écoute !  Bonjour .</p>")).toBe(
    "<p>Écoute ! Bonjour.</p>",
  );
});

test("a speaking task of only an ellipsis (the line is in its audio) gives no prompt", () => {
  const speaking = {
    "Exercise:9": { id: 9, name: "Sprich", inputType: "NONE", inquiries: [{ __ref: "Inquiry:1" }] },
    "Inquiry:1": { inquiryType: "REPEAT", subInquiries: [{ __ref: "Inquiry:11" }] },
    "Inquiry:11": { inquiryText: "...", inquiryDescription: "…" },
  };
  const { exercise, locale, unmapped } = normaliseExercise(
    ctx,
    speaking as never,
    9,
    key,
    "raw/ru-de/a1/e-9.json",
  );
  expect(unmapped).toBeUndefined();
  expect(exercise.items[0]).toEqual({ key: `${key}#1` } as never);
  expect(locale.items).toEqual({});
});

test("a clip on the items: one clip for all is the exercise's video; different clips stay each item's", () => {
  const video = (name: string) => ({
    kind: "video" as const,
    path: `media/video/${name}_sd.mp4` as never,
    sha256: "a".repeat(64),
    size: 1,
    mime: "video/mp4",
  });
  const clips = createContext(
    {
      "https://tvdownloaddw-a.akamaihd.net/downloads/clips/c1_sd.mp4": video("c1"),
      "https://tvdownloaddw-a.akamaihd.net/downloads/clips/c2_sd.mp4": video("c2"),
      "https://static.dw.com/image/1_605.webp": {
        kind: "image",
        path: "media/image/1_605.webp" as never,
        sha256: "b".repeat(64),
        size: 1,
        mime: "image/webp",
      },
    },
    "ru-de",
  );
  const page = (second: string) => ({
    "Exercise:9": {
      id: 9,
      name: "Schau",
      inputType: "NONE",
      inquiries: [{ __ref: "Inquiry:1" }, { __ref: "Inquiry:2" }],
    },
    "Video:1": {
      hlsVideoSrc: "https://hlsvod.dw.com/i/clips/c1_,sd,.mp4.csmil/master.m3u8",
      posterImageUrl: "https://static.dw.com/image/1_605.webp",
    },
    // A still not downloaded: none.
    "Video:2": {
      hlsVideoSrc: "https://hlsvod.dw.com/i/clips/c2_,sd,.mp4.csmil/master.m3u8",
      posterImageUrl: "https://static.dw.com/image/2_605.webp",
    },
    ...Object.fromEntries(
      [1, 2].map((n) => [
        `Inquiry:${n}`,
        {
          inquiryType: "ASSOCIATION",
          selectionType: "SINGLE",
          inquiryText: "Wer ist das?",
          videos: [{ __ref: n === 1 ? "Video:1" : second }],
          subInquiries: [{ __ref: "Inquiry:11" }],
        },
      ]),
    ),
    "Inquiry:11": { alternatives: [{ __ref: "Alt:1" }, { __ref: "Alt:2" }] },
    "Alt:1": { alternativeText: "Nico", isCorrect: true },
    "Alt:2": { alternativeText: "Lisa", isCorrect: false },
  });
  const shared = normaliseExercise(clips, page("Video:1") as never, 9, key, "e-9.json").exercise;
  expect(Exercise.parse(shared).media).toEqual({
    video: "media/video/c1_sd.mp4",
    poster: "media/image/1_605.webp",
  } as never);
  expect(shared.items.map((it) => (it as { media?: unknown }).media)).toEqual([
    undefined,
    undefined,
  ]);
  const own = normaliseExercise(clips, page("Video:2") as never, 9, key, "e-9.json").exercise;
  expect(Exercise.parse(own).media).toBeUndefined();
  expect(own.items.map((it) => (it as { media?: unknown }).media)).toEqual([
    { video: "media/video/c1_sd.mp4", poster: "media/image/1_605.webp" },
    { video: "media/video/c2_sd.mp4" },
  ]);
});
