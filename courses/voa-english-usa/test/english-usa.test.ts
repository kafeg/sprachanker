// Synthetic articles shaped like the site's two layouts; every sentence is invented.
import { expect, test } from "bun:test";
import type { LibraryFile, MediaIndex } from "@sprachanker/course-kit";
import type { CourseIndex, Lesson, LocaleCourse, LocaleLesson } from "@sprachanker/schema";
import { audioUrl, LESSONS } from "../src/catalog.ts";
import { headword, normaliseEnglishUsa, type SourceLesson } from "../src/normalise.ts";
import { parseLesson, wordRow } from "../src/parse.ts";

const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body>
<h1 class="title pg-title">
    ${title}
</h1>
<div class="wsw">
${body}
    </div>
<div class="footer-toolbar"><p>Поделиться</p></div></body></html>`;

const tr = (...cells: string[]) =>
  `<tr valign="top">${cells.map((c) => `<td><p class="MsoNormal">${c}</p></td>`).join("")}</tr>`;
const table = (...rows: string[]) =>
  `<blockquote><div class="wsw__table-container"><table class="wsw__table"><tbody>${rows.join("")}</tbody></table></div></blockquote>`;

/** The 2001 archive layout: `<p />` labels and tables. */
const TABLES = page(
  "Урок английского языка &#x2116;7",
  `<p /><strong>Цель:</strong> Научиться заказывать чай.
<p /><strong>Содержание:</strong> Мартин Лернер заходит в кафе.
<p /><strong>Conversation:</strong>
<p />
${table(
  tr("<strong>Ann:</strong>", "Tea, please."),
  tr("<strong>Waiter Bob:</strong>", "Here you are.<br />"),
)}
<p /><strong>Words and phrases:</strong>
<p /><strong>Nouns:</strong>
${table(tr("cup", "чашка"), tr("horse/horses", "лошадь/лошади"), tr("tea kettle", "чайник"))}
<p /><strong>Pronouns:</strong>
${table(
  tr("we", "мы", "Example: We drink tea", "Например: Мы пьём чай"),
  tr("Example: We like it", "Например: Нам нравится"),
)}
<p /><strong>Verbs:</strong>
${table(tr("to pour/poured", "наливать"), tr("be (is, am, are)", "быть"))}
<p /><strong>Numbers:</strong>
${table(tr("1 - One", "2 - Two"))}
<p /><strong>Homework - Домашнее задание:</strong>
<p class="MsoNormal">1. Прочитайте диалог вслух.</p>
<p>2. Переведите: <b>Чашка чая.</b></p>
<p /><strong>Grammar Notes:</strong>
<p />Глагол <strong>to be</strong> в настоящем времени:
${table(tr("I am", "я есть"))}`,
);

/** The `<br>` layout: `<h3>` labels, tab- or space-separated rows, speakers in `<strong>`. */
const LINES = page(
  "Урок английского языка &#x2116; 52а",
  `<p><strong>Цель:</strong> Повторение.</p>
<p><strong>Содержание:</strong> Мартин в парке.</p>
<h3 class="articleHeader">Conversation:</h3>
<p><strong>Ann:</strong> \tHello, Bob.<br />
<strong>Bob</strong>: Hi! <br />
 <br />
<strong>Ann: </strong>Nice park.</p>
<h3 class="articleHeader">Words and phrases:</h3>
<p><strong>Greetings:<br />
</strong>Good evening! \tДобрый вечер!<br />
Fine, thanks. \tСпасибо, хорошо.</p>
<p><strong>Adverbs: </strong><br />
outside снаружи</p>
<p><strong>Other:<br />
</strong>during Example: I walk during the day в течение Например: Я гуляю днём<br />
park парк<br />
homework \tдомашнее задание</p>
<h3 class="articleHeader">Homework - Домашнее задание:</h3>
<ul class="article"><li>1. Добрый вечер!</li><li>2. Я гуляю.</li></ul>`,
);

test("table layout: goal, synopsis, dialogue, words with examples, pages", () => {
  const p = parseLesson(TABLES);
  expect(p?.title).toBe("Урок английского языка №7");
  expect(p?.goal).toBe("Научиться заказывать чай.");
  expect(p?.synopsis).toBe("Мартин Лернер заходит в кафе.");
  expect(p?.dialogue).toEqual([
    { speaker: "Ann", text: "Tea, please." },
    { speaker: "Waiter Bob", text: "Here you are." },
  ]);
  expect(p?.words.map((w) => [w.category, w.en, w.ru])).toEqual([
    ["Nouns", "cup", "чашка"],
    ["Nouns", "horse/horses", "лошадь/лошади"],
    ["Nouns", "tea kettle", "чайник"],
    ["Pronouns", "we", "мы"],
    ["Verbs", "to pour/poured", "наливать"],
    ["Verbs", "be (is, am, are)", "быть"],
  ]);
  // The example-only row is a second example of "we".
  expect(p?.words[3]).toMatchObject({
    exampleEn: "We drink tea / We like it",
    exampleRu: "Мы пьём чай / Нам нравится",
  });
  expect(p?.pages.map((x) => [x.kind, x.title])).toEqual([
    ["grammar", "Numbers"],
    ["homework", "Homework - Домашнее задание"],
    ["grammar", "Grammar Notes"],
  ]);
  expect(p?.pages[0]?.html).toBe(
    "<table><tbody><tr><td>1 - One</td><td>2 - Two</td></tr></tbody></table>",
  );
  expect(p?.pages[1]?.html).toBe(
    "<p>1. Прочитайте диалог вслух.</p><p>2. Переведите: <b>Чашка чая.</b></p>",
  );
  expect(p?.pages[2]?.html).toContain("<strong>to be</strong>");
  expect(p?.stray).toEqual([]);
});

test("line layout: tabs, a single space or examples between English and Russian", () => {
  const p = parseLesson(LINES);
  expect(p?.title).toBe("Урок английского языка № 52а");
  expect(p?.dialogue).toEqual([
    { speaker: "Ann", text: "Hello, Bob." },
    { speaker: "Bob", text: "Hi!" },
    { speaker: "Ann", text: "Nice park." },
  ]);
  expect(p?.words.map((w) => [w.category, w.en, w.ru])).toEqual([
    ["Greetings", "Good evening!", "Добрый вечер!"],
    ["Greetings", "Fine, thanks.", "Спасибо, хорошо."],
    ["Adverbs", "outside", "снаружи"],
    ["Other", "during", "в течение"],
    ["Other", "park", "парк"],
    // A word row, not the homework label.
    ["Other", "homework", "домашнее задание"],
  ]);
  expect(p?.words[3]).toMatchObject({
    exampleEn: "I walk during the day",
    exampleRu: "Я гуляю днём",
  });
  expect(p?.pages).toEqual([
    {
      kind: "homework",
      title: "Homework - Домашнее задание",
      html: "<p>1. Добрый вечер!</p><p>2. Я гуляю.</p>",
    },
  ]);
});

test("unlabelled parts: dialogue right after the synopsis, homework without a label", () => {
  const p = parseLesson(
    page(
      "Урок 3",
      `<p>Lesson 3</p><p><strong>Цель:</strong> Цель.</p><p><strong>Содержание:</strong> Сюжет.</p>
<p><strong>Ann:</strong> Hello.</p>
<p><strong>Conversation #2:</strong></p><p><strong>Bob:</strong> Bye.</p>
<p><strong>Nouns:</strong><br />cat кошка</p>
<p>1. Прочитайте диалог.</p>`,
    ),
  );
  expect(p?.stray).toEqual(["Lesson 3"]);
  expect(p?.dialogue).toEqual([
    { speaker: "Ann", text: "Hello." },
    { text: "Conversation #2", heading: true },
    { speaker: "Bob", text: "Bye." },
  ]);
  expect(p?.words).toEqual([{ category: "Nouns", en: "cat", ru: "кошка" }]);
  expect(p?.pages.map((x) => x.kind)).toEqual(["homework"]);
  expect(parseLesson("<html><body>Страница не существует</body></html>")).toBeUndefined();
});

test("word rows in either cell order", () => {
  expect(wordRow(["What", "Example: What is it?", "Что?", "Например: Что это?"])).toEqual({
    en: "What",
    ru: "Что?",
    exampleEn: "What is it?",
    exampleRu: "Что это?",
  });
  expect(wordRow(["Example: Where are you from? Откуда вы?"])).toEqual({
    exampleEn: "Where are you from?",
    exampleRu: "Откуда вы?",
  });
  expect(wordRow(["1 - One"])).toEqual({ en: "1 - One" });
});

test.each([
  ["cup", "Nouns", { lemma: "cup", pos: "noun" }],
  ["horse/horses", "Nouns", { lemma: "horse", pos: "noun", plural: "horses" }],
  ["dad, daddy", "Nouns (family)", { lemma: "dad", pos: "noun" }],
  ["Native Americans (Indians)", "Nouns", { lemma: "Native Americans", pos: "noun" }],
  ["to pour/poured", "Verbs", { lemma: "pour", pos: "verb", forms: "poured" }],
  ["be (is, am, are)", "Verbs", { lemma: "be", pos: "verb" }],
  ["to run (manage)", "Verbs", { lemma: "run", pos: "verb" }],
  ["photographer/s", "Nouns", { lemma: "photographer", pos: "noun", plural: "photographers" }],
  ["child/children", "Nouns", { lemma: "child", pos: "noun", plural: "children" }],
  ["waiter/waitress", "Nouns", { lemma: "waiter", pos: "noun" }],
  ["swimming", "Verbs (used as nouns)", { lemma: "swimming", pos: "noun" }],
  ["sad/sadder/saddest", "Adjectives", { lemma: "sad", pos: "adj", forms: "sadder, saddest" }],
  ["to recover", "Other", { lemma: "recover", pos: "verb" }],
  ["Good evening!", "Other", { lemma: "Good evening!", pos: "phrase" }],
  ["Come in", "Other", { lemma: "Come in", pos: "phrase" }],
  ["box, bag, can", "Cultural Notes", { lemma: "box", pos: "word" }],
  ["See you", "Greetings", { lemma: "See you", pos: "phrase" }],
  ["outside", "Adverbs", { lemma: "outside", pos: "word" }],
])("headword %p under %p", (en, category, expected) => {
  expect(headword(en, category)).toEqual(expected as ReturnType<typeof headword>);
});

const validate = (files: LibraryFile[]) =>
  files.flatMap((f) => {
    const r = f.schema.safeParse(f.value);
    return r.success ? [] : [`${f.path}: ${r.error.message}`];
  });

test("normalised files validate; units of ten, review lessons in the unit of their number", () => {
  const tables = parseLesson(TABLES);
  const lines = parseLesson(LINES);
  const labels = ["1", "2", "9", "10", "11", "52", "52а", "85"];
  const lessons: SourceLesson[] = labels.map((label, i) => ({
    label,
    id: String(1000 + i),
    raw: `raw/ru-en/english-usa/${1000 + i}.html`,
    parsed: i % 2 ? lines : tables,
    ...(audioUrl(label) ? { audioUrl: audioUrl(label) } : {}),
    ...(label === "85" ? { textDefect: "repeats lesson 86" } : {}),
  }));
  const url = audioUrl("1") ?? "";
  const index: MediaIndex = {
    [url]: {
      kind: "audio",
      path: "media/audio/russian_english_001.mp3",
      sha256: "0",
      size: 1,
      mime: "audio/mpeg",
    },
  };
  const { files, lessons: count, unmapped } = normaliseEnglishUsa(lessons, index);
  expect(validate(files)).toEqual([]);
  expect(count).toBe(8);
  expect(unmapped).toBe(1);

  const course = files.find((f) => f.path === "canonical/english-usa/course.json")
    ?.value as CourseIndex;
  expect(course.units.map((u) => [String(u.key), u.lessons.map(String)])).toEqual([
    [
      "voa.english-usa/english-usa/u01",
      ["01-01", "01-02", "01-03", "01-04"].map((n) => `voa.english-usa/english-usa/${n}`),
    ],
    ["voa.english-usa/english-usa/u02", ["voa.english-usa/english-usa/02-01"]],
    [
      "voa.english-usa/english-usa/u06",
      ["06-01", "06-02"].map((n) => `voa.english-usa/english-usa/${n}`),
    ],
    ["voa.english-usa/english-usa/u09", ["voa.english-usa/english-usa/09-01"]],
  ]);
  const localeCourse = files.find((f) => f.path === "locale/ru-en/english-usa/course.json")
    ?.value as LocaleCourse;
  expect(localeCourse.units["voa.english-usa/english-usa/u06" as never]).toEqual({
    title: "Уроки 52–52а",
  });
  expect(localeCourse.descriptionHtml).toContain("Voice of America");

  const first = files.find((f) => f.path === "canonical/english-usa/lessons/01-01.json")
    ?.value as Lesson;
  expect(first.media).toEqual({ audio: "media/audio/russian_english_001.mp3" });
  expect(first.goals.map(String)).toEqual(["voa.english-usa/english-usa/01-01/goal-1"]);
  expect(first.vocab.map((v) => [v.key, v.lexeme, v.target])).toEqual([
    ["voa.english-usa/english-usa/01-01/v-cup", "lex:en:cup:noun", "cup"],
    ["voa.english-usa/english-usa/01-01/v-horse", "lex:en:horse:noun", "horse/horses"],
    ["voa.english-usa/english-usa/01-01/v-tea-kettle", "lex:en:tea-kettle:noun", "tea kettle"],
    ["voa.english-usa/english-usa/01-01/v-we", "lex:en:we:word", "we"],
    ["voa.english-usa/english-usa/01-01/v-pour", "lex:en:pour:verb", "to pour/poured"],
    ["voa.english-usa/english-usa/01-01/v-be", "lex:en:be:verb", "be (is, am, are)"],
  ]);
  expect(first.vocab[3]?.note).toBe("We drink tea / We like it");

  const locale = files.find((f) => f.path === "locale/ru-en/english-usa/lessons/01-01.json")
    ?.value as LocaleLesson;
  expect(locale.title).toBe("Урок английского языка №7");
  expect(locale.synopsisHtml).toBe("<p>Мартин Лернер заходит в кафе.</p>");
  expect(locale.vocab["voa.english-usa/english-usa/01-01/v-cup" as never]).toEqual({
    translation: "чашка",
  });
  expect(locale.tabs.script).toEqual({
    title: "Conversation",
    bodyHtml: "<p><b>Ann:</b> Tea, please.</p><p><b>Waiter Bob:</b> Here you are.</p>",
  });
  expect(locale.tabs.grammar.map((t) => t.title)).toEqual([
    "Numbers",
    "Homework - Домашнее задание",
    "Grammar Notes",
  ]);

  // A lesson whose article carries another lesson's text keeps only its recording and title.
  const defect = files.find((f) => f.path === "canonical/english-usa/lessons/09-01.json")
    ?.value as Lesson;
  expect(defect.vocab).toEqual([]);
  expect(defect.unmapped).toEqual([
    { path: "raw/ru-en/english-usa/1007.html", reason: "repeats lesson 86" },
  ]);
});

test("catalog: 106 lessons in course order, recordings for numbered lessons only", () => {
  expect(LESSONS.length).toBe(106);
  expect(new Set(LESSONS.map(([l]) => l)).size).toBe(106);
  expect(LESSONS[52]?.[0]).toBe("52а");
  expect(LESSONS.at(-1)?.[0]).toBe("104а");
  expect(audioUrl("7")).toEndWith("/2001_12/Audio/mp3/russian_english_007.mp3");
  expect(audioUrl("46")).toEndWith("/2001_11/Audio/mp3/russian_english_046.mp3");
  expect(audioUrl("52а")).toBeUndefined();
});
