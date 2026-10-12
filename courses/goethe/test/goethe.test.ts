// The model test pages read and normalised (synthetic pages shaped like the site's: test/pages.ts).
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Exam, type ExamItem, ExamSources, LocaleExam } from "@sprachanker/schema";
import { examOf, type Level } from "../src/catalog.ts";
import { moduleOf, normaliseLevel } from "../src/normalise.ts";
import { optionFor } from "../src/options.ts";
import { audioList, readLongdesc, readPage } from "../src/page.ts";
import { readSolutions } from "../src/solutions.ts";
import { readSpeaking } from "../src/speaking.ts";
import { readWriting } from "../src/writing.ts";
import { writingPrompt } from "../src/writing-exam.ts";
import {
  HOEREN,
  LESEN,
  SCHREIBEN,
  SCHREIBEN_A2,
  SCHREIBEN_B1,
  SCHREIBEN_L1,
  SOLUTIONS,
  SPRECHEN,
  ZETTEL,
} from "./pages.ts";

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
    readAt: 1_000,
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
  // The ads answered by letter: each once in the Teil's material, the options their letters.
  expect(section("lesen-2")?.text).toBeUndefined();
  expect(section("lesen-2")?.letters).toEqual([
    { letter: "a", text: "www.cafe.example\nKuchen und Kaffee." },
    { letter: "b", text: "www.bad.example\nSchwimmen am See." },
  ]);
  expect(section("hoeren-2")?.letters?.map((l) => [l.letter, l.media?.image])).toEqual([
    ["a", "media/image/pa.png"],
    ["b", "media/image/pb.png"],
    ["c", "media/image/pc.png"],
  ]);
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

  // Where it all was read, and what was checked: every page with its copy's sha256, every question
  // with its place and its answer's.
  const sources = ExamSources.parse(
    out.files.find((f) => f.path.endsWith("canonical/a1/sources/modellsatz.json"))?.value,
  );
  expect(sources.documents.map((d) => [d.id, d.raw])).toEqual([
    ["hoeren", "raw/de-de/a1/hoeren.html"],
    ["hoeren_l1", "raw/de-de/a1/solutions/hoeren_l1.html"],
    ["hoeren_l2", "raw/de-de/a1/solutions/hoeren_l2.html"],
    ["hoeren_l3", "raw/de-de/a1/solutions/hoeren_l3.html"],
    ["lesen", "raw/de-de/a1/lesen.html"],
    ["lesen_l1", "raw/de-de/a1/solutions/lesen_l1.html"],
    ["lesen_l2", "raw/de-de/a1/solutions/lesen_l2.html"],
  ]);
  expect(sources.documents[0]?.sha256).toBe(createHash("sha256").update(HOEREN).digest("hex"));
  expect(sources.checks.every((c) => c.passed === c.of)).toBe(true);
  expect(sources.checks.find((c) => c.id === "answers-matched")).toEqual({
    id: "answers-matched",
    passed: 9,
    of: 9,
  });
  expect(sources.items[item("hoeren-2").key]).toEqual([
    { document: "hoeren", at: "Teil 1, Aufgabe 2" },
    { document: "hoeren_l1", at: "Lösung 2" },
  ]);
  expect(Object.keys(sources.items)).toHaveLength(exam.items.length);
});

test("a writing page: a form's lines, the task's points, criteria by levels, bands or maxima", () => {
  const { intro, teile } = readWriting(SCHREIBEN);
  expect(intro).toEqual(["Reguläre Prüfungszeit: circa 30 Minuten"]);
  expect(teile.map((t) => t.title)).toEqual(["Teil 1", "Teil 2", "Teil 3", "Aufgabe 4"]);
  const [form, perPoint, bands, maxima] = teile;
  expect(form?.heading).toBe("Kurs Anmeldung");
  expect(form?.fields).toEqual([
    { label: "Name:", value: "Tom Weber" },
    { label: "Alter:", gap: 1 },
    { label: "Der Kurs ist zu bezahlen." },
    { label: "Zahlung:", gap: 2, choices: ["Bar", "Karte"] },
  ]);
  expect(form?.criteria).toEqual([]);
  expect(perPoint).toMatchObject({
    points: ["Warum schreiben Sie?", "Fragen Sie: Preis?"],
    box: "Eingabetextfeld",
    form: { action: "schreiben.php?#t2" },
  });
  expect(perPoint?.instructions).toEqual([
    "Schreiben Sie an die Schule:",
    "• Warum schreiben Sie?",
    "• Fragen Sie: Preis?",
    "Schreiben Sie auch eine Anrede und einen Gruß.",
  ]);
  expect(perPoint?.criteria.map((c) => [c.title, c.levels.map((l) => l.points)])).toEqual([
    ["Erfüllung der Aufgabenstellung (pro Inhaltspunkt)", [3, 1.5, 0]],
    ["Kommunikative Gestaltung des Textes", [1, 0.5, 0]],
  ]);
  // A band table: a criterion's aspects together in each band; its note voids it.
  expect(bands?.criteria).toEqual([
    {
      title: "Aufgabenerfüllung",
      levels: [{ text: "Inhalt: alles; Register: passend" }, { text: "Inhalt: wenig" }],
      voids: true,
    },
    {
      title: "Sprache",
      levels: [{ text: "Spektrum: reich" }, { text: "Spektrum: arm" }],
      voids: false,
    },
  ]);
  expect(maxima).toMatchObject({
    pictures: [{ src: "../medien/x/forum.jpg" }],
    links: ["../medien/x/forum.html"],
    box: "Ihre Meinung",
    criteria: [
      { title: "Erfüllung", max: 4, levels: [] },
      { title: "Wortschatz", max: 6, levels: [] },
    ],
  });
  expect(maxima?.instructions).toEqual([
    "Reguläre Prüfungszeit: 10 Minuten",
    "Im Forum lesen Sie:",
  ]);
});

test("writing normalised: the form's gaps from its solution page, texts rated by their criteria", () => {
  const level: Level = {
    ...LEVEL,
    modules: ["schreiben"],
    writing: { bands: { 5: [5, 2.5, 0], 4: [4, 2, 0], 6: [6, 3, 0] }, max: 5, voids: "Erfüllung" },
  };
  const out = normaliseLevel(level, {
    modules: [{ id: "schreiben", html: SCHREIBEN }],
    solution: (file) => (file === "schreiben_l1.php" ? SCHREIBEN_L1 : undefined),
    longdesc: (url) => (url.endsWith("forum.html") ? "Ana: Ich chatte gern." : undefined),
    media: (url) => `media/image/${url.split("/").pop()}` as never,
    readAt: 1_000,
  });
  expect(out.problems).toEqual([]);
  const exam = Exam.parse(out.files.find((f) => f.path.includes("canonical/a1/exams"))?.value);
  const locale = LocaleExam.parse(
    out.files.find((f) => f.path.includes("locale/de-de/a1/exams"))?.value,
  );
  expect(exam.modules).toEqual([{ id: "schreiben", timeLimitSec: 1800, scaleTo: 25 }]);
  const item = (id: string) => exam.items.find((i) => i.key.endsWith(`/q-${id}`));
  const section = (slug: string) => exam.sections.find((s) => s.key.endsWith(`/s-${slug}`));
  // The form: its lines as the section's text, a gap typed, a choice ticked.
  expect(section("schreiben-1")?.text).toBe(
    "Kurs Anmeldung\nName: Tom Weber\nAlter: (1)\nDer Kurs ist zu bezahlen.\nZahlung: (2) Bar / Karte",
  );
  expect(item("schreiben-1-1")).toMatchObject({
    type: "gap_text",
    segments: ["Alter: ", { gap: "g1" }],
    answer: { g1: { accepted: ["20", "zwanzig"] } },
  });
  expect(item("schreiben-1-2")).toMatchObject({
    type: "single_choice",
    prompt: "Zahlung:",
    answer: { optionIds: ["a"] },
  });
  // Per point: a criterion of each point with the page's points; the form's own.
  expect(item("schreiben-2")).toMatchObject({
    type: "respond",
    input: "text",
    // The box's label names the box: the task says what to write.
    prompt: "Schreiben Sie an die Schule",
    criteria: [
      { id: "inhaltspunkt-1", levels: [3, 1.5, 0] },
      { id: "inhaltspunkt-2", levels: [3, 1.5, 0] },
      { id: "kommunikative-gestaltung-des-textes", levels: [1, 0.5, 0] },
    ],
  });
  expect(locale.items[item("schreiben-2")?.key as never]?.criteria?.["inhaltspunkt-2"]).toEqual({
    title: "Inhaltspunkt 2: Fragen Sie: Preis?",
    levels: ["voll erfüllt", "teilweise", "nicht erfüllt"],
  });
  // Bands: the sheet's points for the page's maximum (none on the page: the level's).
  expect(item("schreiben-3")?.criteria).toEqual([
    { id: "aufgabenerfuellung", levels: [5, 2.5, 0], voids: true },
    { id: "sprache", levels: [5, 2.5, 0] },
  ]);
  expect(item("schreiben-3")?.prompt).toBe("Schreiben Sie eine SMS.");
  expect(item("schreiben-4")?.prompt).toBe("Ihre Meinung");
  expect(item("schreiben-4")?.criteria).toEqual([
    { id: "erfuellung", levels: [4, 2, 0], voids: true },
    { id: "wortschatz", levels: [6, 3, 0] },
  ]);
  expect(section("schreiben-4")).toMatchObject({
    text: "Ana: Ich chatte gern.",
    media: { image: "media/image/forum.jpg" },
  });
  expect(locale.sections[section("schreiben-4")?.key as never]?.instructions).toBe(
    "Prüfungszeit: 10 Minuten\nIm Forum lesen Sie:",
  );
  const sources = ExamSources.parse(
    out.files.find((f) => f.path.includes("canonical/a1/sources"))?.value,
  );
  expect(sources.documents.map((d) => d.id)).toEqual(["schreiben", "schreiben_l1"]);
  expect(sources.checks.find((c) => c.id === "criteria-read")).toEqual({
    id: "criteria-read",
    passed: 3,
    of: 3,
  });
  expect(sources.items[item("schreiben-1-1")?.key as never]).toEqual([
    { document: "schreiben", at: "Teil 1, (1)" },
    { document: "schreiben_l1", at: "Lösung 1" },
  ]);
});

test("speaking normalised: a part per number, the learner's cards, the partner's apart, the criteria", () => {
  expect(readSpeaking(SPRECHEN).criteria).toEqual([
    { parts: [2], title: "Erfüllung", max: 4 },
    { parts: [1, 2, 3], title: "Aussprache", max: 6 },
  ]);
  const level: Level = {
    ...LEVEL,
    modules: ["sprechen"],
    speaking: {
      criteria: { 1: [{ title: "Sich vorstellen", levels: [3, 1.5, 0] }] },
      bands: { 4: [4, 2, 0], 6: [6, 3, 0] },
      voids: "Erfüllung",
    },
  };
  const out = normaliseLevel(level, {
    modules: [{ id: "sprechen", html: SPRECHEN }],
    solution: () => undefined,
    longdesc: (url) =>
      url.endsWith("kal_a.html")
        ? "Samstag: Kino"
        : url.endsWith("kal_b.html")
          ? "Samstag: Sport"
          : undefined,
    media: (url) => `media/image/${url.split("/").pop()}` as never,
    readAt: 1_000,
  });
  expect(out.problems).toEqual([]);
  const exam = Exam.parse(out.files.find((f) => f.path.includes("canonical/a1/exams"))?.value);
  const locale = LocaleExam.parse(
    out.files.find((f) => f.path.includes("locale/de-de/a1/exams"))?.value,
  );
  expect(exam.modules).toEqual([{ id: "sprechen", timeLimitSec: 720, scaleTo: 25 }]);
  const section = (n: number) => exam.sections.find((s) => s.key.endsWith(`/s-sprechen-${n}`));
  const item = (n: number) => exam.items.find((i) => i.key.endsWith(`/q-sprechen-${n}`));
  expect(exam.sections).toHaveLength(3);
  // The level's criteria where the page lists none for the part.
  expect(item(1)).toMatchObject({
    type: "respond",
    input: "speech",
    criteria: [{ id: "sich-vorstellen", levels: [3, 1.5, 0] }],
  });
  expect(locale.sections[section(1)?.key as never]?.instructions).toBe(
    "Sich vorstellen.\nName?\nAlter?",
  );
  // The cards by theme as letters; candidate B's card is the partner's.
  expect(section(2)?.letters).toEqual([
    { letter: "1", text: "Essen: Brot", media: { image: "media/image/k1.gif" } },
    { letter: "2", text: "Essen: Milch", media: { image: "media/image/k2.gif" } },
  ]);
  expect(item(2)).toMatchObject({
    partner: "Wochenende?",
    criteria: [{ id: "erfuellung", levels: [4, 2, 0], voids: true }],
  });
  // A and B of one part: one section, the calendar's text the learner's card, B's the partner's;
  // a criterion of all parts with the last.
  expect(section(3)?.letters).toEqual([
    { letter: "1", text: "Samstag: Kino", media: { image: "media/image/ka.png" } },
  ]);
  expect(item(3)).toMatchObject({
    partner: "Finden Sie einen Termin.\nSamstag: Sport",
    criteria: [{ id: "aussprache", levels: [6, 3, 0] }],
  });
  expect(locale.sections[section(3)?.key as never]?.title).toBe("Teil 3");
  expect(locale.items[item(3)?.key as never]?.criteria).toEqual({
    aussprache: { title: "Aussprache (Aufgabe 1, 2, 3)" },
  });
});

test("the regulations' pass marks when their modules are all there", () => {
  const level: Level = {
    ...LEVEL,
    modules: ["sprechen"],
    speaking: {
      criteria: { 1: [{ title: "x", levels: [1, 0] }] },
      bands: { 4: [4, 0], 6: [6, 0] },
    },
    marks: [
      { id: "pass", minPoints: 15, title: "Gesamt" },
      { id: "spoken", minPoints: 5, modules: ["sprechen"], title: "Mündlich" },
    ],
  };
  const pages = {
    modules: [{ id: "sprechen" as const, html: SPRECHEN }],
    solution: () => undefined,
    longdesc: () => "x",
    media: () => undefined,
    readAt: 1,
  };
  const exam = Exam.parse(
    normaliseLevel(level, pages).files.find((f) => f.path.includes("canonical/a1/exams"))?.value,
  );
  expect(exam.thresholds).toEqual([
    { id: "pass", minPoints: 15 },
    { id: "spoken", minPoints: 5, modules: ["sprechen"] },
  ]);
  expect(exam.passWhen).toBe("all");
  // A mark of a module not imported: 60 % of what there is.
  const without = Exam.parse(
    normaliseLevel(
      { ...level, marks: [{ id: "w", minPoints: 1, modules: ["schreiben"], title: "W" }] },
      pages,
    ).files.find((f) => f.path.includes("canonical/a1/exams"))?.value,
  );
  expect(without.thresholds).toEqual([{ id: "pass", minPoints: 15 }]);
});

test("a text to write named by its task, never by its box's label", () => {
  const prompt = (box: string, ...instructions: string[]) =>
    writingPrompt({ box, instructions, title: "Teil 2" });
  expect(prompt("Ihre Meinung", "Schreiben Sie nun Ihre Meinung (circa 50 Wörter).")).toBe(
    "Ihre Meinung",
  );
  expect(
    prompt(
      "Eingabetextfeld",
      "Sie fahren nach Bonn. Schreiben Sie an das Hotel:",
      "• Wann kommen Sie?",
      "Schreiben Sie zu jedem Punkt einen Satz in das Eingabetextfeld (ca. 20 Wörter).",
    ),
  ).toBe("Schreiben Sie an das Hotel");
  expect(
    prompt(
      "Textfeld für E-Mail",
      "Prüfungszeit: 10 Minuten",
      "Ihr Freund hat Geburtstag.",
      "• Beschreiben Sie: Was schenken Sie?",
      "Schreiben Sie eine E-Mail (circa 60 Wörter).",
      "Schreiben Sie etwas zu allen Punkten.",
    ),
  ).toBe("Schreiben Sie eine E-Mail.");
  expect(
    prompt(
      "Eingabetextfeld",
      "Sie sind im Zug und schreiben eine SMS an Ihren Bruder.",
      "Schreiben Sie 20 Wörter.",
    ),
  ).toBe("Sie sind im Zug und schreiben eine SMS an Ihren Bruder.");
  // A date or an abbreviation ends no sentence; a date is no length.
  expect(
    prompt(
      "Eingabetextfeld",
      "Sie sind z. B. am 3. Mai in Wien. Schreiben Sie am 4. Mai an Ihre Tante.",
    ),
  ).toBe("Schreiben Sie am 4. Mai an Ihre Tante.");
  // No sentence says what to write: the task's first sentence, else the Teil's title — never none.
  expect(
    prompt("Eingabetextfeld", "Prüfungszeit: 15 Minuten", "Ihr Chef ruft an. Antworten Sie."),
  ).toBe("Ihr Chef ruft an.");
  expect(prompt("Eingabetextfeld", "Schreiben Sie auch einen Gruß.")).toBe("Teil 2");
  // Minutes in the task are no exam time; the time's own sentences are.
  expect(
    prompt(
      "Eingabetextfeld",
      "Reguläre Prüfungszeit: circa 20 Minuten",
      "Sie kommen 30 Minuten zu spät. Schreiben Sie Ihrer Lehrerin.",
    ),
  ).toBe("Schreiben Sie Ihrer Lehrerin.");
  expect(
    prompt("Eingabetextfeld", "Prüfungszeit: 10 Minuten", "Sie kommen 30 Minuten zu spät."),
  ).toBe("Sie kommen 30 Minuten zu spät.");
  // An abbreviation ends no sentence; a number's full stop before a request does.
  expect(
    prompt("Eingabetextfeld", "Ihr Arzt, Dr. Weber, hat Tel. 123. Schreiben Sie ihm eine E-Mail."),
  ).toBe("Schreiben Sie ihm eine E-Mail.");
  expect(prompt("Eingabetextfeld", "Ihr Freund wird 30. Schreiben Sie ihm eine Karte.")).toBe(
    "Schreiben Sie ihm eine Karte.",
  );
  expect(prompt("Eingabetextfeld", "Prüfungszeit: 15 Minuten", "• Danken Sie.")).toBe("Teil 2");
});

test("writing normalised at A2 and B1: every text to write has its task as its prompt", () => {
  const prompts = (course: Level["course"], html: string, writing: Level["writing"]) => {
    const out = normaliseLevel(
      { ...LEVEL, course, modules: ["schreiben"], writing },
      {
        modules: [{ id: "schreiben", html }],
        solution: () => undefined,
        longdesc: () => undefined,
        media: (url) => `media/image/${url.split("/").pop()}` as never,
        readAt: 1_000,
      },
    );
    expect(out.problems).toEqual([]);
    const exam = Exam.parse(
      out.files.find((f) => f.path.includes(`canonical/${course}/exams`))?.value,
    );
    return Object.fromEntries(
      exam.items.map((i) => [i.key.split("/q-")[1], i.type === "respond" ? i.prompt : undefined]),
    );
  };
  expect(prompts("a2", SCHREIBEN_A2, { bands: { 5: [5, 3.5, 2, 0.5, 0] }, max: 5 })).toEqual({
    "schreiben-1": "Schreiben Sie am 4. Mai eine Nachricht an Ihre Freundin Ada.",
    "schreiben-2": "Ihr Kollege Ben lädt Sie z. B. am 1. Juni zum Essen ein.",
  });
  expect(
    prompts("b1", SCHREIBEN_B1, { bands: { 4: [4, 3, 2, 1, 0] }, voids: "Erfüllung" }),
  ).toEqual({
    "schreiben-1": "Schreiben Sie eine E-Mail an Ihren Freund Ole.",
    "schreiben-3": "Aufgabe 3",
  });
});
