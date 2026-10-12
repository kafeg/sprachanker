// The lesson as the tasks see it: the course's people taken from a script's speakers.
import { expect, test } from "bun:test";
import { speakersOf } from "../src/tasks/lesson.ts";

test("a script's speakers by name: labels in capitals, or alone on their line; never a sentence's opening word", () => {
  const html = [
    "<p><strong>ANNA:</strong><br />Hallo, Tom.</p>",
    "<p><strong>TOM:</strong> Hallo! Also: wie geht's?</p>",
    "<p>Frau Berg:<br />Guten Tag.</p>",
    "<p>Also: Das ist alles.</p>",
    "<p><strong>ANNA-LENA:</strong> Tschüss!</p>",
  ].join("\n");
  expect(speakersOf(html)).toEqual(["Anna", "Tom", "Frau Berg", "Anna-Lena"]);
});
