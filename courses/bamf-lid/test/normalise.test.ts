// The catalogue and the test centre joined into the exam, on invented questions.
import { expect, test } from "bun:test";
import { CourseIndex, Exam, LocaleExam, type MediaPath } from "@sprachanker/schema";
import { EXAM_KEY } from "../src/catalog.ts";
import type { Catalogue, CatalogueQuestion } from "../src/catalogue.ts";
import type { CentreQuestion } from "../src/centre.ts";
import { type CentreAddress, likeness, normaliseExam, unpaired } from "../src/normalise.ts";

const pixels = { width: 1, height: 1, channels: 3 as const, data: new Uint8Array(3) };
const image = { page: 1, x: 0, y: 0, width: 1, height: 1, pixels };

const question = (
  state: string | null,
  number: number,
  extra: Partial<CatalogueQuestion> = {},
) => ({
  state,
  number,
  stem: `Frage ${number}?`,
  options: ["eins", "Bürger/Bürgerin", "drei", "vier"],
  pictures: [],
  ...extra,
});

function centre(q: CatalogueQuestion, right = 1): CentreQuestion {
  return {
    number: 0,
    total: 310,
    // The test centre writes the gender pair the other way round.
    options: q.options.map((text, i) => ({
      text: text === "Bürger/Bürgerin" ? "Bürgerin / Bürger" : text.replace(/^Bild /, ""),
      right: i === right,
    })),
  };
}

const catalogue = (questions: CatalogueQuestion[]): Catalogue => ({
  stand: "2030-02-01",
  questions,
});

function run(
  questions: CatalogueQuestion[],
  answers?: (a: CentreAddress) => CentreQuestion | undefined,
) {
  const byAddress = new Map<string, CatalogueQuestion>();
  for (const q of questions)
    byAddress.set(q.state === null ? `null:${q.number}` : `sl:${300 + q.number}`, q);
  return normaliseExam(
    catalogue(questions),
    answers ??
      ((a) => {
        const q = byAddress.get(`${a.state}:${a.number}`);
        return q && centre(q);
      }),
    (id) =>
      new Map<string, MediaPath>(
        id === "002"
          ? ["a", "b", "c", "d"].map((p) => [p, `media/image/lid-002-${p}.png` as MediaPath])
          : id === "sl-01"
            ? [["item", "media/image/lid-sl-01.png" as MediaPath]]
            : [],
      ),
  );
}

test("options pair up when each reads most like its counterpart, however the sources word it", () => {
  expect(likeness("Bild 3", "3")).toBe(1);
  expect(likeness("Bürger/Bürgerin", "Bürgerin / Bürger")).toBeGreaterThan(0.8);
  const catalogue = [
    "selbstständig tätig",
    "Die Wählerin/der Wähler darf wählen",
    "Kirchensteuer",
    "vor etwa 700 Jahren",
  ];
  const centre = [
    "selbständig tätig",
    "Der Wähler darf wählen",
    "Kirchensteuern",
    "vor etwa 700 Jahren",
  ];
  expect(unpaired(catalogue, centre)).toBeUndefined();
  // Two options swapped, or one that reads like another: not the same list.
  expect(unpaired(catalogue, [centre[0], centre[2], centre[1], centre[3]] as string[])).toBe(1);
  expect(
    unpaired(
      ["vor etwa 300 Jahren", "vor etwa 700 Jahren"],
      ["vor etwa 700 Jahren", "vor etwa 300 Jahren"],
    ),
  ).toBe(0);
  expect(unpaired(["eins", "zwei"], ["eins", "ganz anders"])).toBe(1);
  // Options of the same words in another order are told apart by their text.
  const zones = ["1=A, 2=B, 3=C", "1=B, 2=A, 3=C", "1=A, 2=C, 3=B"];
  expect(unpaired(zones, [...zones])).toBeUndefined();
});

test("the exam: every question keyed by part and number, the right option from the test centre", () => {
  const questions = [
    question(null, 1),
    question(null, 2, {
      options: ["Bild 1", "Bild 2", "Bild 3", "Bild 4"],
      pictures: [image, image, image, image],
    }),
    question("Saarland", 1, { pictures: [image], credit: "© Jemand" }),
  ];
  const { files, problems, questions: taken, leftOut } = run(questions);
  // The catalogue counts 460 questions; this one is a sample.
  expect(problems).toEqual(["the catalogue has 3 questions, not 460"]);
  expect([taken, leftOut]).toEqual([3, 0]);
  const exam = Exam.parse(files.find((f) => f.path.endsWith("exams/test.json"))?.value);
  expect(exam.key).toBe(EXAM_KEY);
  expect(
    exam.items.map((i) => [i.key.split("/q-")[1], i.tags.federalState, i.answer.optionIds]),
  ).toEqual([
    ["001", null, ["b"]],
    ["002", null, ["b"]],
    ["sl-01", "sl", ["b"]],
  ]);
  expect(exam.items[0]?.options[1]).toEqual({ id: "b", text: "Bürger/Bürgerin" });
  // A row of pictures is the options; a single picture the question's, with its credit.
  expect(exam.items[1]?.options.map((o) => o.media?.image)).toEqual([
    "media/image/lid-002-a.png",
    "media/image/lid-002-b.png",
    "media/image/lid-002-c.png",
    "media/image/lid-002-d.png",
  ]);
  expect(exam.items[2]?.media).toEqual({ image: "media/image/lid-sl-01.png", credit: "© Jemand" });
  expect(exam.sections.map((s) => [s.pool.length, s.draw, s.filter])).toEqual([
    [2, 30, null],
    [1, 3, { tag: "federalState", setting: "exam.federalState" }],
  ]);
  expect(exam.thresholds.map((t) => t.minPoints)).toEqual([15, 17]);
  // The course is an exam only; its texts are German.
  const course = CourseIndex.parse(
    files.find((f) => f.path.endsWith("canonical/lid/course.json"))?.value,
  );
  expect([course.units, course.exams]).toEqual([[], [EXAM_KEY]]);
  LocaleExam.parse(files.find((f) => f.path.startsWith("locale/de-de/lid/exams/"))?.value);
});

test("a question is left out, and said why, when the sources disagree or the answer is missing", () => {
  const questions = [
    question(null, 1),
    question(null, 2),
    question(null, 3),
    question("Saarland", 1),
  ];
  const { files, problems, leftOut } = run(questions, (a) => {
    const q = questions[a.state ? 3 : a.number - 1] as CatalogueQuestion;
    if (a.number === 2)
      return {
        ...centre(q),
        options: centre(q).options.map((o, i) => (i === 0 ? { ...o, text: "anders" } : o)),
      };
    if (a.number === 3) return undefined;
    return centre(q);
  });
  expect(problems.slice(0, 2)).toEqual([
    '002: option 1 reads "eins" in the catalogue, "anders" in the test centre',
    "003: the test centre's page was not read",
  ]);
  const exam = Exam.parse(files.find((f) => f.path.endsWith("exams/test.json"))?.value);
  expect(exam.items.map((i) => i.key.split("/q-")[1])).toEqual(["001", "sl-01"]);
  expect(leftOut).toBe(2);
});
