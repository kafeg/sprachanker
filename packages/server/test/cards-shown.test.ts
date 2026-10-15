// What a card shows where it is studied (cards.ts `shown`), over the service itself: a
// list of many cards reads the courses once; which course's entry a language's queue shows.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { openLibrary } from "@sprachanker/course-kit";
import { nodeFs } from "@sprachanker/course-kit/node";
import { Deck, type LessonKey } from "@sprachanker/schema";
import { createCardStore } from "../src/services/card-store.ts";
import { createCards } from "../src/services/cards.ts";
import { createContent } from "../src/services/content.ts";
import { createRunStore } from "../src/services/run-store.ts";
import { createSettings } from "../src/services/settings.ts";
import { createWords } from "../src/services/words.ts";
import { setup } from "./setup.ts";

const COURSE = "sprachanker.fixture/demo";
const FIRST = `${COURSE}/00-01` as LessonKey;
const SECOND = `${COURSE}/00-02` as LessonKey;

/** The fixture course copied as `demo2`, its translations marked ("кофе" → "кофе (demo2)"). */
function copyCourse(root: string) {
  const series = join(root, "library", FIXTURE_SERIES);
  const files = [...new Bun.Glob("**/*.json").scanSync({ cwd: series })].filter((f) =>
    /^(canonical|locale\/[^/]+)\/demo\//.test(f),
  );
  for (const file of files) {
    const text = readFileSync(join(series, file), "utf8")
      .replace(/sprachanker\.fixture\/demo(?=[/"])/g, "sprachanker.fixture/demo2")
      .replace(/"кофе"/g, '"кофе (demo2)"');
    const to = join(series, file.replace(/(^|\/)demo\//, "$1demo2/"));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
  return { course: `${FIXTURE_SERIES}/demo2`, lesson: FIRST.replace("/demo/", "/demo2/") };
}

/** An imported deck of `size` words of its own, then Kaffee. */
const bigDeck = (size: number): Deck =>
  Deck.parse({
    format: 1,
    id: "big-1a2b3c",
    title: "Big",
    lang: "de",
    translationLang: "ru",
    source: { file: "big.apkg", importedAt: 0 },
    words: [
      ...Array.from({ length: size }, (_, i) => ({
        key: `n${i}`,
        target: `wort${i}`,
        lexeme: `lex:de:wort${i}:word`,
        translation: `слово ${i}`,
        tags: [],
      })),
      {
        key: "k",
        target: "der Kaffee",
        lexeme: "lex:de:kaffee:noun:m",
        gender: "m",
        translation: "кофе (напиток)",
        tags: [],
      },
    ],
  });

/** The cards service over the test's profile, its content counted: how often the courses are listed
 *  and a lesson read; `read`: the audio read aloud for a deck, by `<folder> <lexeme>`. */
async function withService(size = 0, read: Record<string, string> = {}) {
  const api = await setup();
  const other = copyCourse(api.root);
  const content = createContent(openLibrary(nodeFs, join(api.root, "library")));
  const counted = { courses: 0, lessons: 0 };
  const deck = bigDeck(size);
  const store = createRunStore({ db: api.profile, now: Date.now, appVersion: "test" });
  const cardStore = createCardStore(api.profile);
  const cards = createCards({
    cards: cardStore,
    store,
    content: {
      ...content,
      courses: () => {
        counted.courses++;
        return content.courses();
      },
      lessonWithLocale: (...args: Parameters<typeof content.lessonWithLocale>) => {
        counted.lessons++;
        return content.lessonWithLocale(...args);
      },
    },
    decks: { deck: (id) => (id === deck.id ? deck : undefined), list: () => [] },
    settings: createSettings(api.profile),
    session: async () => undefined,
    myCourses: async () => new Set(),
    readAudio: (folder, lexeme) => read[`${folder} ${lexeme}`],
    madeFor: () => false,
    studiedBy: () => [],
    now: Date.now,
  });
  const words = createWords({ cards: cardStore, store, shown: cards.shown });
  return { ...api, other, deck, cards, cardStore, words, counted };
}

test("My words over many cards: the courses listed once, each read once, until cards are relinked", async () => {
  const { cards, words, deck, other, counted } = await withService(300);
  // The deck's words taken first, then a lesson of each course (Kaffee stays the deck's card).
  await cards.takeDeck({ deck: deck.id });
  for (const lessonKey of [FIRST, other.lesson.replace("00-01", "00-02") as LessonKey])
    await cards.fromLesson({ series: FIXTURE_SERIES, lessonKey, edition: "ru-de" });
  const listed = await words.list();
  expect(listed).toHaveLength(301 + 3 + 2);
  // One listing for every card asking at once; each course's two lessons read once for its words
  // (the two lessons' cards made read theirs too).
  expect(counted).toEqual({ courses: 1, lessons: 2 + 4 });
  await words.list();
  expect(counted).toEqual({ courses: 1, lessons: 2 + 4 });
  // Relinked (a course installed or normalised again): listed and read anew, once.
  counted.courses = 0;
  counted.lessons = 0;
  await cards.relink();
  await words.list();
  expect(counted).toEqual({ courses: 1, lessons: 4 });
});

test("a language's queue: the card's own course, else the first of the learner's courses by deck that has the word", async () => {
  const { cards, cardStore, deck, other } = await withService();
  await cards.takeDeck({ deck: deck.id });
  // The copy's lesson first: by deck, the fixture course (`demo`) still comes before it.
  await cards.fromLesson({
    series: FIXTURE_SERIES,
    lessonKey: other.lesson as LessonKey,
    edition: "ru-de",
  });
  const kaffee = () =>
    cardStore.all().find((n) => n.lexemeKey === "lex:de:kaffee:noun:m") as NonNullable<
      ReturnType<typeof cardStore.all>[number]
    >;
  // Only the copy has cards: its entry.
  expect(await cards.shown(kaffee(), "lang:de")).toMatchObject({
    translation: "кофе (demo2)",
    lessonKey: other.lesson,
  });
  await cards.fromLesson({ series: FIXTURE_SERIES, lessonKey: SECOND, edition: "ru-de" });
  // Both: the first by deck.
  expect(await cards.shown(kaffee(), "lang:de")).toMatchObject({
    translation: "кофе",
    lessonKey: FIRST,
  });
  // The deck's own entry in the deck; a course's deck its own.
  expect(await cards.shown(kaffee(), `deck:${deck.id}`)).toMatchObject({
    translation: "кофе (напиток)",
    deck: deck.id,
  });
  expect(await cards.shown(kaffee(), `course:${other.course}`)).toMatchObject({
    translation: "кофе (demo2)",
  });
  // A lesson's Words step: that lesson's entry; a lesson without the word, the card as made.
  expect(await cards.shown(kaffee(), `lesson:ru-de:${FIRST}`)).toMatchObject({
    translation: "кофе",
    lessonKey: FIRST,
    audio: "media/audio/kaffee.mp3",
  });
  expect(await cards.shown(kaffee(), `lesson:ru-de:${SECOND}`)).toEqual(kaffee().display);
  // A card of a course shows its own course's entry wherever the others are.
  const gern = cardStore.all().find((n) => n.lexemeKey === "lex:de:gern:word");
  expect(gern?.deck).toBe(`course:${other.course}`);
  expect(await cards.shown(gern as NonNullable<typeof gern>, "lang:de")).toMatchObject({
    lessonKey: other.lesson,
  });
});

test("an imported deck with neither a recording of the word nor its reading plays the card's own recording", async () => {
  const read: Record<string, string> = {};
  const { cards, cardStore, deck } = await withService(0, read);
  // Kaffee's card made by the course, with its recording; the deck has the word without one.
  await cards.fromLesson({ series: FIXTURE_SERIES, lessonKey: FIRST, edition: "ru-de" });
  const kaffee = cardStore.all().find((n) => n.lexemeKey === "lex:de:kaffee:noun:m");
  const scope = `deck:${deck.id}`;
  const inDeck = () => cards.shown(kaffee as NonNullable<typeof kaffee>, scope);
  expect(await inDeck()).toMatchObject({
    target: "der Kaffee",
    translation: "кофе (напиток)",
    deck: deck.id,
    recordingPath: `library/${FIXTURE_SERIES}/media/audio/kaffee.mp3`,
  });
  // Read aloud for the deck: its reading.
  read[`${deck.id} lex:de:kaffee:noun:m`] = `${deck.id}/media/read-kaffee.wav`;
  const shown = await inDeck();
  expect(shown.readAudio).toBe(`${deck.id}/media/read-kaffee.wav`);
  expect(shown.recordingPath).toBeUndefined();
});
