// Synthetic pages shaped like the site's (invented sentences); no real content.
import { expect, test } from "bun:test";
import type { MediaIndex } from "@sprachanker/course-kit";
import {
  type CourseIndex,
  type Lesson,
  LessonKey,
  type LocaleCourse,
  type LocaleExercise,
  type LocaleLesson,
  parseLessonKey,
} from "@sprachanker/schema";
import { gapKey, variants } from "../src/exercise.ts";
import { normaliseLingust, partOfSpeech, type UnitSource } from "../src/normalise.ts";
import { parseIndex, parseLesson, parseVerbTable } from "../src/parse.ts";
import { englishLine, withoutRussianRemarks } from "../src/text.ts";

const BASE = "https://lingust.ru/english/english-lessons/lesson3";
const page = (body: string) => `<html><body><div class="com-content-article__body">
<div class="bg-en"><div class="tac">Header<br> Lesson Three</div></div>
<div class="module-title-surround"><h1 class="title tac">Пробный урок</h1></div>
${body}
<p>Курс доступен в виде приложения на iOS и андроид:</p>
<div class="row"><div class="col-4"><a href="https://apps.apple.com/x"><img src="/images/a.png"></a></div></div>
</div></body></html>`;

const INDEX = `<div class="course-container">
<div class="level-divider"><div class="part-title">🌱 ЭТАП 1. Начало (Уроки 1–2)</div></div>
<a href="/english/english-lessons/lesson1" class="lesson-row"><div class="lesson-num">Урок 1</div>
<div class="lesson-body"><div class="lesson-title">Первый</div><div class="lesson-desc">Описание &laquo;один&raquo;</div></div>
<span class="lvl lvl-a1">A1</span></a>
<div class="level-divider"><div class="part-title">📦 Бонусы</div></div>
<a href="/english/english-lessons/irregular-verbs" class="lesson-row"><div class="lesson-title">Таблица</div><span class="lvl">📖</span></a>
</div>`;

const LESSON = page(`
<p class="eg3">Вступление к уроку.</p>
<h2 class="tac">Грамматика</h2>
<p class="eg3">Глагол <strong>run</strong> /rʌn/ – бежать.</p>
<div class="cplayer cplayer--center" data-src="/media/sound/eng/course/lesson3/lesson3-s1.mp3"></div>
<p class="egml3">I run fast. – Я бегаю быстро.<br> We r<strong>u</strong>n home. – Мы бежим домой.</p>
<div class="row"><div class="col-6"><p class="tac"><strong>Monday</strong> Понедельник</p></div><div class="col-6"><p class="tac"><strong>Friday</strong> Пятница</p></div></div>
<div class="cplayer cplayer--center" data-src="/media/sound/eng/course/lesson3/lesson3-s2.mp3"></div>
<p class="eg3">Объяснение после таблицы.</p>
<div class="cplayer-lock cplayer-lock--center"></div>
<p class="egml3">Why is it late? – Почему уже поздно?</p>
<div class="audio-notice">🔒 Здесь должно быть аудио.</div>
<p>Текст <span data-tooltips data-tooltips-content="перевод абзаца, довольно длинный, чтобы стоять отдельно">с подсказкой</span>.</p>
<p class="tac"><strong>Словарь</strong></p>
<div class="row"><div class="col-12 col-md-6"> <strong>bed</strong> /bed/ кровать
<br> <strong>open</strong> /'əʊpən/ <em>v.</em> открывать; <em>adj.</em> открытый
<br> <strong>swim</strong> /swɪm/ плавать; <em>прош.</em> <strong>swam</strong> /swæm/; <em>прич.</em> <strong>swum</strong> /swʌm/
<br> <strong>look around</strong> осмотреться</div></div>
<h3 class="tac">Упражнения</h3>
<p><strong>Упражнение 1</strong>. Вставьте глагол.</p>
<ol>
<li>He <input name="w" type="text" value="runs" readonly> home. <input class="form-control" name="w" type="text" value="Он бежит домой." readonly></li>
<li>She <input name="w" type="text"> fast and <input name="w" type="text"> (когда) late. <input class="form-control" name="w" type="text"></li>
<li>They <input name="w" type="text"> it. <input class="form-control" name="w" type="text"></li>
</ol>
<p class="tar"><span data-tooltips data-tooltips-content="2. <strong>runs, is</strong>: Она бегает быстро и опаздывает.<br> 3. <strong>do/did</strong>: Они делают это." data-tooltips-title="Упражнение 1"><img class="key" src="/images/key.png"></span></p>
<p><strong>Упражнение 2</strong>. Переведите на английский.</p>
<ol>
<li>Я бегаю. <input class="form-control" name="w" type="text"></li>
<li>Мы спим (досл.: отдыхаем). <input class="form-control" name="w" type="text"></li>
</ol>
<p class="tar"><span data-tooltips data-tooltips-content="1. I run.<br> 2. We sleep. (<em>можно:</em> We are sleeping)" data-tooltips-title="Упражнение 2"><img class="key" src="/images/key.png"></span></p>
<p><strong>Упражнение 3</strong>. Переведите на русский.</p>
<ol><li>I run. <input class="form-control" name="w" type="text"></li></ol>
<p class="tar"><span data-tooltips data-tooltips-content="1. Я бегаю." data-tooltips-title="Упражнение 3"><img class="key" src="/images/key.png"></span></p>
<p><strong>Упражнение 4</strong>. Выберите форму.</p>
<form><ol><li>There <select><option></option><option>is</option><option>are</option></select> a cat. <input class="form-control" type="text"></li></ol></form>
<p class="tar"><span data-tooltips data-tooltips-content="1. <strong>is:</strong> Там кошка." data-tooltips-title="Упражнение 4"><img class="key" src="/images/key.png"></span></p>
<p><strong>Упражнение 5</strong>. Перескажите текст вслух.</p>
<p><strong>Exercise 6</strong>. Write the years.</p>
<div class="cplayer cplayer--full" data-src="/media/sound/eng/course/lesson3/lesson3-ex6.mp3"></div>
<p><textarea class="form-control"></textarea></p>
<p class="tar"><span data-tooltips data-tooltips-content="1999, 2001" data-tooltips-title="Exercise 6"><img class="key" src="/images/key.png"></span></p>
<p class="tac"><strong>See you!</strong><br><em>До встречи!</em></p>
<div class="cplayer cplayer--center" data-src="/media/sound/eng/course/lesson3/lesson3-bye.mp3"></div>
`);

const VERBS =
  page(`<p>Таблица глаголов.</p><div class="table-responsive"><table><caption>Таблица</caption><tbody>
<tr class="tac"><td>Инфинитив</td><td>Прошедшее</td><td>Причастие II</td><td>Перевод</td></tr>
<tr><td>sing /sɪŋ/</td><td>sang</td><td>sung</td><td>петь</td></tr>
<tr><td>burn</td><td>burnt<br>burned</td><td>burnt<br>burned</td><td>гореть,<br>жечь</td></tr>
</tbody></table></div>`);

test("index: stages with lessons, emoji stripped", () => {
  const stages = parseIndex(INDEX);
  expect(stages.map((s) => s.title)).toEqual(["ЭТАП 1. Начало (Уроки 1–2)", "Бонусы"]);
  expect(stages[0]?.lessons).toEqual([
    { slug: "lesson1", title: "Первый", desc: "Описание «один»", level: "A1" },
  ]);
  expect(stages[1]?.lessons[0]?.slug).toBe("irregular-verbs");
});

test("lesson page: sections, examples with recordings, vocabulary", () => {
  const p = parseLesson(LESSON, BASE);
  expect(p.title).toBe("Пробный урок");
  expect(p.sections.map((s) => s.title)).toEqual(["Пробный урок", "Грамматика"]);
  const [s1, s2, locked] = p.sections[1]?.snippets ?? [];
  expect(s1).toEqual({
    audio: "https://lingust.ru/media/sound/eng/course/lesson3/lesson3-s1.mp3",
    lines: [
      { en: "I run fast.", ru: "Я бегаю быстро." },
      { en: "We run home.", ru: "Мы бежим домой." },
    ],
  });
  // A table read after it is shown: the player takes the rows before it.
  expect(s2?.lines.map((l) => l.en)).toEqual(["Monday", "Friday"]);
  expect(locked).toEqual({ lines: [{ en: "Why is it late?", ru: "Почему уже поздно?" }] });
  expect(p.vocab).toEqual([
    { head: "bed", ipa: "/bed/", translation: "кровать", marks: [], forms: [] },
    {
      head: "open",
      ipa: "/'əʊpən/",
      translation: "v. открывать; adj. открытый",
      marks: ["v", "adj"],
      forms: [],
    },
    {
      head: "swim",
      ipa: "/swɪm/",
      translation: "плавать; прош. swam; прич. swum",
      marks: [],
      forms: ["swam", "swum"],
    },
    { head: "look around", translation: "осмотреться", marks: [], forms: [] },
  ]);
});

test("lesson page: exercises with their keys, examples marked, closing phrase", () => {
  const p = parseLesson(LESSON, BASE);
  expect(p.exercises.map((e) => e.label)).toEqual([
    "Упражнение 1",
    "Упражнение 2",
    "Упражнение 3",
    "Упражнение 4",
    "Упражнение 5",
    "Exercise 6",
  ]);
  const [first] = p.exercises;
  expect(first?.instructionHtml).toBe("Вставьте глагол.");
  expect(first?.units.map((u) => [u.n, u.example, u.fields])).toEqual([
    ["1", true, 1],
    ["2", false, 1],
    ["3", false, 1],
  ]);
  expect(first?.units[2]?.key).toEqual(["<strong>do/did</strong>: Они делают это."]);
  const last = p.exercises[5];
  expect(last?.textarea).toBe(true);
  expect(last?.freeKey).toEqual(["1999, 2001"]);
  expect(last?.epilogue).toEqual([
    {
      audio: "https://lingust.ru/media/sound/eng/course/lesson3/lesson3-bye.mp3",
      lines: [{ en: "See you!" }],
    },
  ]);
});

test.each([
  ["I do. – Я делаю.", { en: "I do.", ru: "Я делаю." }],
  ["Always (всегда)", { en: "Always" }],
  ["c<strong>a</strong>t (кошка), d<strong>o</strong>g (собака)", { en: "cat, dog" }],
  ["Well нам уже известно, как междометие ‘ну’, и так далее", undefined],
  ["Новый глагол: speak", undefined],
])("english line %p", (line, expected) => {
  expect(englishLine(line)).toEqual(expected);
});

test("answers: bold key parts, variants, remarks", () => {
  expect(gapKey(["<strong>has ... taken</strong>: Он взял."], 2)).toEqual({
    answers: ["has", "taken"],
    translation: "Он взял.",
  });
  expect(
    gapKey(["<strong>happier</strong> (<em>можно:</em> more), <strong>than</strong>: Х."], 2)
      .answers,
  ).toEqual(["happier", "than"]);
  expect(variants("who/that")).toEqual(["who", "that"]);
  expect(variants("(the) car")).toEqual(["(the) car", "car", "the car"]);
  expect(withoutRussianRemarks("He goes (досл.: идёт (туда)).")).toBe("He goes.");
});

test.each([
  ["swim", [], ["swam", "swum"], "verb"],
  ["open", ["v", "adj"], [], "word"],
  ["close", ["v"], [], "verb"],
  ["to be", [], [], "verb"],
  ["look around", [], [], "phrase"],
  ["bed", [], [], "word"],
])("part of speech %p", (head, marks, forms, pos) => {
  expect(partOfSpeech(head, marks, forms)).toBe(pos as ReturnType<typeof partOfSpeech>);
});

test("normalisation: stages → units, exercises by mechanic, all files valid", () => {
  const audio = (name: string) => ({
    kind: "audio" as const,
    path: `media/audio/${name}`,
    sha256: "x",
    size: 1,
    mime: "audio/mpeg",
  });
  const index: MediaIndex = Object.fromEntries(
    ["lesson3-s1.mp3", "lesson3-s2.mp3", "lesson3-ex6.mp3", "lesson3-bye.mp3"].map((n) => [
      `https://lingust.ru/media/sound/eng/course/lesson3/${n}`,
      audio(n),
    ]),
  );
  const [stage, bonus] = parseIndex(INDEX);
  const units: UnitSource[] = [
    {
      title: stage?.title ?? "",
      lessons: [
        {
          kind: "lesson",
          info: { slug: "lesson3", title: "Пробный", desc: "Описание", level: "A1" },
          page: parseLesson(LESSON, BASE),
        },
      ],
    },
    {
      title: bonus?.title ?? "",
      lessons: [
        {
          kind: "verbs",
          info: { slug: "irregular-verbs", title: "Таблица", desc: "", level: "📖" },
          ...parseVerbTable(VERBS),
        },
      ],
    },
  ];
  const { files, lessons, unknown } = normaliseLingust(units, index);
  expect([lessons, unknown]).toEqual([2, 1]);
  for (const f of files) expect(f.schema.safeParse(f.value).error).toBeUndefined();
  const get = (path: string) => files.find((f) => f.path === path)?.value;
  // Branded key types compared with plain strings.
  const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  expect(plain((get("canonical/english/course.json") as CourseIndex).units)).toEqual([
    { key: "lingust.english/english/u01", order: 1, lessons: ["lingust.english/english/01-01"] },
    { key: "lingust.english/english/u02", order: 2, lessons: ["lingust.english/english/02-01"] },
  ]);
  expect((get("locale/ru-en/english/course.json") as LocaleCourse).descriptionHtml).toContain(
    "© Lingust",
  );

  const lesson = get("canonical/english/lessons/01-01.json") as Lesson;
  expect(plain(LessonKey.parse(lesson.key))).toBe("lingust.english/english/01-01");
  expect(parseLessonKey(lesson.key).name).toBe("01-01");
  expect(lesson.pages.map((p) => p.exercise.type)).toEqual([
    "speech_selfrate", // examples of the "Грамматика" section
    "gap_text",
    "respond",
    "unknown", // translation into Russian
    "gap_choice",
    "speech_selfrate", // retell aloud
    "respond", // years from the recording
    "speech_selfrate", // the closing phrase
  ]);
  const [examples, gaps, translate, , choice, , years] = lesson.pages.map((p) => p.exercise);
  expect(examples?.items.map((i) => ("text" in i ? i.text : undefined))).toEqual([
    "I run fast.\nWe run home.",
    "Monday\nFriday",
    "Why is it late?",
  ]);
  expect(examples?.items[0]?.media).toEqual({ audio: "media/audio/lesson3-s1.mp3" });
  expect(plain(gaps?.items)).toEqual([
    {
      key: "lingust.english/english/01-01/ex-02#1",
      segments: ["She ", { gap: "g1" }, " fast and ", { gap: "g2" }, " late."],
      answer: { g1: { accepted: ["runs"] }, g2: { accepted: ["is"] } },
    },
    {
      key: "lingust.english/english/01-01/ex-02#2",
      segments: ["They ", { gap: "g1" }, " it."],
      answer: { g1: { accepted: ["do", "did"] } },
    },
  ]);
  expect(translate?.items.map((i) => ("reference" in i ? i.reference : []))).toEqual([
    ["I run."],
    ["We sleep."],
  ]);
  expect(choice?.items[0]).toMatchObject({ answer: { g1: "a" }, display: "dropdown" });
  expect(years).toMatchObject({ media: { audio: "media/audio/lesson3-ex6.mp3" } });
  expect(plain(lesson.vocab.map((v) => v.lexeme))).toEqual([
    "lex:en:bed:word",
    "lex:en:open:word",
    "lex:en:swim:verb",
    "lex:en:look-around:phrase",
  ]);

  const locale = get("locale/ru-en/english/lessons/01-01.json") as LocaleLesson;
  expect(locale.title).toBe("Урок 3. Пробный");
  expect(locale.tabs.grammar.map((t) => t.title)).toEqual(["Пробный урок", "Грамматика"]);
  const grammar = locale.tabs.grammar[1]?.bodyHtml ?? "";
  expect(grammar).not.toContain("Здесь должно быть аудио");
  expect(grammar).toContain("<table><tbody><tr><td>");
  expect(grammar).toContain("<small>перевод абзаца");
  expect(
    (locale.exercises as Record<string, LocaleExercise>)["lingust.english/english/01-01/ex-03"]
      ?.items["#2"],
  ).toEqual({
    prompt: "Мы спим (досл.: отдыхаем).",
  });
  expect(
    (locale.exercises as Record<string, LocaleExercise>)["lingust.english/english/01-01/ex-02"]
      ?.items["#1"],
  ).toEqual({
    hintHtml: "<p>Она бегает быстро и опаздывает.</p>",
  });

  const verbs = get("canonical/english/lessons/02-01.json") as Lesson;
  expect(verbs.vocab.map((v) => [v.target, v.forms, v.note])).toEqual([
    ["sing", "sang, sung", "/sɪŋ/"],
    ["burn", "burnt / burned, burnt / burned", undefined],
  ]);
});

test("a recording without its own lines gets none, not an example further down", () => {
  const html = page(`
<h2 class="tac">Алфавит</h2>
<p class="eg3">В алфавите 26 букв.</p>
<div class="cplayer cplayer--center" data-src="/media/sound/eng/course/lesson1/abc.mp3"></div>
<div class="row tac"><div class="col-6"><p>А а (эй) /eɪ/</p></div><div class="col-6"><p>В b (би:) /bi:/</p></div></div>
<p class="eg3">Слово car: сначала британский, затем американский вариант:</p>
<div class="row"><div class="col-12 col-md-6"><div class="cplayer" data-src="/media/sound/eng/course/lesson1/car1.mp3"></div></div><div class="col-12 col-md-6"><div class="cplayer" data-src="/media/sound/eng/course/lesson1/car2.mp3"></div></div></div>
<p class="eg3">Дальше по тексту — диалог.</p>
<div class="row"><div class="col-12 col-sm-6"><div>My name is Tom.</div></div><div class="col-12 col-sm-6"><div>Меня зовут Том.</div></div></div>
`);
  const p = parseLesson(html, BASE);
  const snippets = p.sections.flatMap((s) => s.snippets);
  expect(snippets.map((s) => [s.audio?.split("/").pop(), s.lines.length])).toEqual([
    ["abc.mp3", 0],
    ["car1.mp3", 0],
    ["car2.mp3", 0],
  ]);
});
