// The catalogue parser on invented lines and pictures shaped like the PDF's (never its text).
import { expect, test } from "bun:test";
import { parseCatalogue } from "../src/catalogue.ts";
import type { PdfImage, PdfLine } from "../src/pdf.ts";

const BOX = " ";
let y = 700;
const at = (page: number, text: string, x = 71): PdfLine => {
  y -= 20;
  return { page, y, x, text };
};
const picture = (page: number, x: number, top: number, height = 100): PdfImage => ({
  page,
  x,
  y: top - height,
  width: 90,
  height,
  pixels: { width: 1, height: 1, channels: 3, data: new Uint8Array(3) },
});

function sample() {
  y = 800;
  const lines: PdfLine[] = [
    at(1, "Testkatalog"),
    at(1, "Stand: 01.02.2030"),
    at(1, "Seite 1 von 3", 450),
  ];
  y = 720;
  lines.push(
    at(2, "Teil I", 280),
    at(2, "Allgemeine Fragen", 250),
    at(2, "Aufgabe 1"),
    at(2, "Wie heißt die erste"),
    at(2, "Frage?"),
    at(2, `${BOX}Antwort eins`, 114),
    at(2, `${BOX}eine lange Antwort, die`, 114),
    at(2, "weiter geht", 142),
    at(2, `${BOX}Antwort drei`, 114),
    at(2, `${BOX}Antwort vier`, 114),
    at(2, "Aufgabe 2"),
    at(2, "2.   Welches Bild zeigt das Wappen?"),
    at(2, "Bild 1 Bild 2 Bild 3 Bild 4"),
    at(2, `${BOX}Bild 1`, 114),
    at(2, `${BOX}Bild 2`, 114),
    at(2, `${BOX}Bild 3`, 114),
    at(2, `${BOX}Bild 4`, 114),
    at(2, "Seite 2 von 3", 450),
  );
  y = 720;
  const head = at(3, "Teil II", 280);
  lines.push(
    head,
    at(3, "Fragen für das Bundesland Saarland", 200),
    at(3, "Aufgabe 1"),
    at(3, "Was zeigt dieses Bild?"),
  );
  // The picture stands between the stem and its credit.
  const stemY = y;
  lines.push(
    { page: 3, y: stemY - 140, x: 71, text: "© Jemand/Fotograf" },
    { page: 3, y: stemY - 170, x: 114, text: `${BOX}eins` },
    { page: 3, y: stemY - 190, x: 114, text: `${BOX}zwei` },
    { page: 3, y: stemY - 210, x: 114, text: `□ drei` },
    { page: 3, y: stemY - 230, x: 114, text: `${BOX}vier` },
  );
  const images = [
    // The page head's logo is not a question's.
    picture(2, 9, 800),
    // A row of four, not quite level, drawn in another order.
    picture(2, 291, 476),
    picture(2, 80, 470),
    picture(2, 403, 468),
    picture(2, 187, 474),
    picture(3, 71, stemY - 10, 120),
  ];
  return { lines, images, stemY };
}

test("questions by section and number: stems joined, wrapped options, the number before a stem gone", () => {
  const { lines, images } = sample();
  const { stand, questions } = parseCatalogue(lines, images);
  expect(stand).toBe("2030-02-01");
  expect(questions.map((q) => [q.state, q.number])).toEqual([
    [null, 1],
    [null, 2],
    ["Saarland", 1],
  ]);
  expect(questions[0]).toMatchObject({
    stem: "Wie heißt die erste Frage?",
    options: [
      "Antwort eins",
      "eine lange Antwort, die weiter geht",
      "Antwort drei",
      "Antwort vier",
    ],
    pictures: [],
  });
  expect(questions[0]?.credit).toBeUndefined();
  // "Teil II" above the next section is not the last option's.
  expect(questions[1]?.options.at(-1)).toBe("Bild 4");
  expect(questions[1]?.stem).toBe("Welches Bild zeigt das Wappen?");
});

test("pictures go to the question above them: a row left to right, a single one with its credit", () => {
  const { lines, images } = sample();
  const [, crests, photo] = parseCatalogue(lines, images).questions;
  expect(crests?.pictures.map((p) => p.x)).toEqual([80, 187, 291, 403]);
  expect(photo).toMatchObject({
    stem: "Was zeigt dieses Bild?",
    options: ["eins", "zwei", "drei", "vier"],
    credit: "© Jemand/Fotograf",
  });
  expect(photo?.pictures).toHaveLength(1);
});

test("a catalogue without its date is refused", () => {
  expect(() => parseCatalogue([{ page: 1, y: 700, x: 71, text: "Aufgabe 1" }], [])).toThrow(
    /Stand/,
  );
});
