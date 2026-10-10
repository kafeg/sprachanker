// The model test pages read and normalised (synthetic pages shaped like the site's: test/pages.ts).
import { expect, test } from "bun:test";
import { Exam, type ExamItem, LocaleExam } from "@sprachanker/schema";
import { examOf, type Level } from "../src/catalog.ts";
import { moduleOf, normaliseLevel, optionFor } from "../src/normalise.ts";
import { audioList, readLongdesc, readPage } from "../src/page.ts";
import { readSolutions } from "../src/solutions.ts";
import { HOEREN, LESEN, SOLUTIONS, ZETTEL } from "./pages.ts";

const LEVEL: Level = {
  course: "a1",
  dir: "x_test",
  title: "Testzertifikat",
  modules: ["hoeren", "lesen"],
  scaleTo: 25,
  apart: false,
  rounding: "total",
  approxBytes: 0,
};

test("a page's recordings are its audio list in player order, never the links beside the players", () => {
  expect(audioList(HOEREN)).toHaveLength(5);
  expect(audioList(HOEREN)[4]).toBe("../medien/x/teil3.mp4");
  const audio = readPage(HOEREN).flatMap((b) => (b.kind === "audio" ? [b.src] : []));
  expect(audio).toEqual(audioList(HOEREN));
  // The page before its "Inhalt" anchor (the navigation) is not read.
  expect(readPage(HOEREN).some((b) => b.kind === "text" && b.text === "Menü")).toBe(false);
});

test("Teile: instructions, examples apart, a recording before a question or after a group, letters", () => {
  const { intro, teile } = moduleOf(HOEREN);
  expect(intro).toContain("Reguläre Prüfungszeit: circa 12 Minuten");
  expect(teile.map((t) => t.title)).toEqual(["Teil 1", "Teil 2", "Teil 3"]);
  const [one, two, three] = teile as [(typeof teile)[0], (typeof teile)[0], (typeof teile)[0]];
  expect(one.instructions).toEqual(["Kreuzen Sie an. Sie hören jeden Text zweimal."]);
  expect(one.questions.map((q) => [q.example, q.number, q.audio])).toEqual([
    [true, 0, "../medien/x/bsp1.mp4"],
    [false, 1, "../medien/x/q1.mp4"],
    [false, 2, "../medien/x/q2.mp4"],
  ]);
  // A heading's situation besides its legend.
  expect(one.questions[2]?.heading).toBe("Du bist im Zug und hörst:");
  // Teil 2: the recording before its questions is the Teil's; a table's columns are questions
  // answered by letter, the example the one holding a letter; the pictures a–c are the letters.
  expect(two.audio).toBe("../medien/x/teil2.mp4");
  expect(two.questions.map((q) => [q.example, q.line, q.typed?.value])).toEqual([
    [true, "Montag", "c"],
    [false, "Dienstag", ""],
    [false, "Mittwoch", ""],
  ]);
  expect(two.letters.map((l) => [l.letter, l.picture?.alt])).toEqual([
    ["a", "Kino"],
    ["b", "Bad"],
    ["c", "Park"],
  ]);
  // Teil 3: a recording after all its questions is the Teil's.
  expect(three.audio).toBe("../medien/x/teil3.mp4");
  expect(three.questions.every((q) => !q.audio)).toBe(true);
});

test("solution pages in both forms; an answer names an option by text, letter or letter and text", () => {
  expect(readSolutions(SOLUTIONS["hoeren_l1.php"] as string)).toEqual([
    { number: 1, answers: ["Elf Euro."] },
    { number: 2, answers: ["Richtig."] },
  ]);
  expect(
    readSolutions("<table><tr><th>1</th><td></td><td>4 / vier</td><td>0</td></tr></table>"),
  ).toEqual([{ number: 1, answers: ["4", "vier"] }]);
  const options = [
    { id: "a", text: "a krank." },
    { id: "b", text: "b froh." },
  ];
  expect(optionFor("b froh.", options)).toBe("b");
  expect(optionFor("Bild a", options)).toBe("a");
  expect(optionFor("B", options)).toBe("b");
  expect(
    optionFor("richtig", [
      { id: "a", text: "Richtig." },
      { id: "b", text: "Falsch." },
    ]),
  ).toBe("a");
  expect(optionFor("c", options)).toBeUndefined();
});

test("a picture's text page: its lines without the way back or a script", () => {
  expect(readLongdesc(ZETTEL)).toBe("Hallo Ute,\nder Vater kommt.\nBis bald");
});

test("a level normalised: modules timed and scaled, Teile with their material, every answer from its page", () => {
  const out = normaliseLevel(LEVEL, {
    modules: [
      { id: "hoeren", html: HOEREN },
      { id: "lesen", html: LESEN },
    ],
    solution: (file) => SOLUTIONS[file],
    longdesc: (url) => (url.endsWith("zettel.html") ? readLongdesc(ZETTEL) : undefined),
    media: (url) =>
      `media/${url.endsWith(".mp4") ? "audio" : "image"}/${url.split("/").pop()}` as never,
  });
  expect(out.problems).toEqual([]);
  expect(out.leftOut).toBe(0);
  const exam = Exam.parse(
    out.files.find((f) => f.path.endsWith("canonical/a1/exams/modellsatz.json"))?.value,
  );
  const locale = LocaleExam.parse(
    out.files.find((f) => f.path.includes("locale/de-de/a1/exams"))?.value,
  );
  expect(exam.key).toBe(examOf(LEVEL));
  expect(exam.modules).toEqual([
    { id: "hoeren", timeLimitSec: 720, scaleTo: 25 },
    { id: "lesen", timeLimitSec: 480, scaleTo: 25 },
  ]);
  expect(exam.timeLimitSec).toBe(1200);
  // 60 % of the points of the modules there are.
  expect(exam.thresholds).toEqual([{ id: "pass", minPoints: 30 }]);
  const section = (slug: string) => exam.sections.find((s) => s.key.endsWith(`/s-${slug}`));
  expect(section("hoeren-1")).toMatchObject({ module: "hoeren", plays: 2, draw: 2 });
  expect(section("hoeren-1")?.examples).toHaveLength(1);
  expect(section("hoeren-2")).toMatchObject({
    plays: 1,
    media: { audio: "media/audio/teil2.mp4" },
  });
  expect(section("lesen-1")?.text).toBe("Ein Brief\n\nLiebe Ute, ich komme morgen.");
  expect(section("lesen-2")?.text).toBe(
    "a\nwww.cafe.example\nKuchen und Kaffee.\n\nb\nwww.bad.example\nSchwimmen am See.",
  );
  expect(locale.sections[section("hoeren-1")?.key as never]).toEqual({
    title: "Teil 1",
    instructions: "Kreuzen Sie an. Sie hören jeden Text zweimal.",
  });
  expect(locale.modules).toEqual({ hoeren: { title: "Hören" }, lesen: { title: "Lesen" } });

  const item = (id: string) =>
    exam.items.find((i) => i.key.endsWith(`/q-${id}`)) as Extract<
      ExamItem,
      { type: "single_choice" }
    >;
  // Pictures as options, with their descriptions in the locale.
  expect(item("hoeren-1")).toMatchObject({
    prompt: "Was kostet es?",
    media: { audio: "media/audio/q1.mp4" },
    answer: { optionIds: ["b"] },
  });
  expect(item("hoeren-1").options[0]).toEqual({
    id: "a",
    text: "Zehn Euro.",
    media: { image: "media/image/1a.gif" },
  });
  expect(locale.items[item("hoeren-1").key]).toEqual({ alt: { a: "Zehn Euro", b: "Elf Euro" } });
  expect(item("hoeren-2")).toMatchObject({
    text: "Du bist im Zug und hörst:",
    answer: { optionIds: ["a"] },
  });
  // By letter: the Teil's pictures as options.
  expect(item("hoeren-3")).toMatchObject({ prompt: "Dienstag", answer: { optionIds: ["b"] } });
  expect(item("hoeren-3").options.map((o) => o.text)).toEqual(["a", "b", "c"]);
  expect(item("hoeren-6").answer.optionIds).toEqual(["b"]);
  // A question's picture and its text page; a solution numbered by its own Teil taken by order.
  expect(item("lesen-1")).toMatchObject({
    media: { image: "media/image/brief.jpg" },
    text: "Hallo Ute,\nder Vater kommt.\nBis bald",
    answer: { optionIds: ["b"] },
  });
  // Ads by letter with "X" for none.
  expect(item("lesen-2").options.map((o) => o.text)).toEqual(["a", "b", "X"]);
  expect(item("lesen-3").answer.optionIds).toEqual(["c"]);
  // The examples answered as marked, in no pool.
  const examples = exam.sections.flatMap((s) => s.examples ?? []);
  expect(examples).toHaveLength(3);
  expect(exam.sections.some((s) => s.pool.some((k) => examples.includes(k)))).toBe(false);
  expect(item(`${examples[1]?.split("/q-")[1]}`).answer.optionIds).toEqual(["c"]);
});
