// Synthetic pages shaped like the site's; no real content.
import { expect, test } from "bun:test";
import { CourseIndex, Lesson, LocaleCourse, LocaleLesson } from "@sprachanker/schema";
import { germanOf, headword, normaliseDib } from "../src/normalise.ts";
import { parseChapter, parseVocabulary } from "../src/parse.ts";

const section = (n: number, de: string, en: string, rows: string[][], audio?: string) => `
<!-- Vokabular: Kap 2, section ${n}: vs_0${n} -->
<div class="voc_sec"><span class="hi_de">${de}</span> <span class="hi_en">${en}</span></div>
${audio ? `<audio controls><source src="${audio}" type="audio/mpeg"></audio>` : ""}
<table>${rows.map(([a, b]) => `<tr class="r"><td>${a}</td><td>${b}</td></tr>`).join("\n")}</table>`;

const VOC = `<html><body>
${section(
  1,
  "Im Zoo",
  "At the zoo",
  [
    ["der Hund (Hunde)", "dog"],
    ["die Gr&ouml;&szlig;e", "size"],
  ],
  "https://media.example/voc_02_01.mp3",
)}
${section(2, "Sachen", "Things", [
  ["das Ding (Dinge)", "thing"],
  ["das Ding (Dinge)", "object"],
  ["", "skipped"],
])}
</body></html>`;

const TOC = `<img src="k2.png" alt="Kapitel 2: Ein Tag &amp; eine Nacht"><a href="pdfs/k_02.pdf">PDF</a>`;

test("vocabulary page: sections with titles, audio and rows", () => {
  const sections = parseVocabulary(VOC);
  expect(sections.map((s) => [s.n, s.titleDe, s.titleEn, s.audio, s.rows.length])).toEqual([
    [1, "Im Zoo", "At the zoo", "https://media.example/voc_02_01.mp3", 2],
    [2, "Sachen", "Things", undefined, 2],
  ]);
  expect(sections[0]?.rows[1]).toEqual({ de: "die Größe", en: "size" });
});

test("chapter page: title and textbook PDF", () => {
  expect(parseChapter(TOC)).toEqual({ title: "Ein Tag & eine Nacht", pdf: "pdfs/k_02.pdf" });
});

test.each([
  ["der Apfel (Äpfel)", { lemma: "Apfel", pos: "noun", gender: "m", plural: "die Äpfel" }],
  ["der Stift (die Stifte)", { lemma: "Stift", pos: "noun", gender: "m", plural: "die Stifte" }],
  ["die Butter (no plural)", { lemma: "Butter", pos: "noun", gender: "f", note: "nur Singular" }],
  ["die Nudeln (plural only ?)", { lemma: "Nudeln", pos: "noun", gender: "pl" }],
  ["das Brot, die Semmel (Brote, Semmeln)", { lemma: "Brot", pos: "noun", gender: "n" }],
  ["die Seife / das Gel", { lemma: "Seife", pos: "noun", gender: "f" }],
  // The source states no part of speech: by shape, as every provider — no guessing from endings.
  ["sich anziehen", { lemma: "sich anziehen", pos: "word" }],
  ["aufstehen", { lemma: "aufstehen", pos: "word" }],
  ["Notizen machen", { lemma: "Notizen machen", pos: "word" }],
  ["etwas (ein)kaufen", { lemma: "etwas einkaufen", pos: "word" }],
  ["Wie geht's?", { lemma: "Wie geht's?", pos: "phrase" }],
  ["gern", { lemma: "gern", pos: "word" }],
])("headword %p", (de, expected) => {
  expect(headword(de)).toEqual(expected as ReturnType<typeof headword>);
});

test("normalisation: chapters → units, sections → lessons, all files valid", () => {
  const { files, lessons } = normaliseDib(
    [{ k: 2, ...parseChapter(TOC), sections: parseVocabulary(VOC) }],
    {
      "https://media.example/voc_02_01.mp3": {
        kind: "audio",
        path: "media/audio/voc_02_01.mp3",
        sha256: "x",
        size: 1,
        mime: "audio/mpeg",
      },
      "https://coerll.utexas.edu/dib/pdfs/k_02.pdf": {
        kind: "pdf",
        path: "media/pdf/k_02.pdf",
        sha256: "y",
        size: 1,
        mime: "application/pdf",
      },
    },
  );
  expect(lessons).toBe(2);
  for (const f of files)
    expect([f.path, f.schema.safeParse(f.value).error?.issues]).toEqual([f.path, undefined]);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.value]));
  const index = CourseIndex.parse(byPath["canonical/dib/course.json"]);
  expect(JSON.parse(JSON.stringify(index.units.map((u) => [u.key, u.lessons])))).toEqual([
    ["coerll.dib/dib/u02", ["coerll.dib/dib/02-01", "coerll.dib/dib/02-02"]],
  ]);
  const first = Lesson.parse(byPath["canonical/dib/lessons/02-01.json"]);
  expect(first.media.audio as string).toBe("media/audio/voc_02_01.mp3");
  expect(first.pages).toEqual([]);
  const second = Lesson.parse(byPath["canonical/dib/lessons/02-02.json"]);
  expect(second.vocab.map((v) => v.key as string)).toEqual([
    "coerll.dib/dib/02-02/v-ding",
    "coerll.dib/dib/02-02/v-ding.2",
  ]);
  const locale = LocaleLesson.parse(byPath["locale/en-de/dib/lessons/02-01.json"]);
  expect(locale.title).toBe("Im Zoo · At the zoo");
  expect(locale.downloads.map((d) => [d.title, d.path as string])).toEqual([
    // Named by the chapter as the source names it, nothing of our own.
    ["Ein Tag & eine Nacht (PDF)", "media/pdf/k_02.pdf"],
  ]);
  expect(Object.values(locale.vocab).map((v) => v.translation)).toEqual(["dog", "size"]);
  const course = LocaleCourse.parse(byPath["locale/en-de/dib/course.json"]);
  expect(Object.values(course.units)).toEqual([{ title: "Ein Tag & eine Nacht" }]);
});

test("the source's English remarks leave the German the learner reads; the word's fields say them", () => {
  expect(germanOf("das Eis (no plural)")).toBe("das Eis");
  expect(germanOf("die Leute (only plural)")).toBe("die Leute");
  expect(germanOf("der Tisch (Tische)")).toBe("der Tisch (Tische)");
  expect(headword("die Leute (only plural)")).toEqual({
    lemma: "Leute",
    pos: "noun",
    gender: "pl",
  });
  expect(headword("das Obst (typically, no plural)")).toMatchObject({ note: "nur Singular" });
});
