// The lesson as the tasks see it: the course's people taken from a script's speakers. The scripts
// are synthetic, shaped as a course's are: a label in capitals alone on its line, the line said under
// it; or a label in mixed case before what is said on the same line.
import { expect, test } from "bun:test";
import { speakersOf } from "../src/tasks/lesson.ts";

test("a script's speakers: labels in capitals on their own line, each speaking more than once", () => {
  const html = [
    "<p><strong>TIPP:</strong><br />Hör gut zu.</p>",
    "<p><strong>ANNA:</strong><br />Hallo, Tom.<br /><strong>TOM:</strong><br />Hallo!</p>",
    "<p><strong>ANNA:</strong><br />Also: Wie geht's?</p>",
    "<p><strong>MAX/TOM:</strong><br />Gut!</p>",
    "<p><strong>​TOM:</strong><br />Und dir?</p>",
    "<p><strong>ANNA-LENA:</strong><br />Hier bin ich.</p>",
    "<p><strong>ANNA-LENA:</strong><br />Tschüss!</p>",
    "<p><strong>VATER VON TOM:</strong><br />Tom, komm!</p>",
    "<p><strong>VATER VON TOM:</strong><br />Jetzt!</p>",
    // Once only: a heading, a one-off line, a group.
    "<p><strong>LOTTE:</strong><br />Ich auch!</p>",
    "<p><strong>ALLE:</strong><br />Ja!</p>",
  ].join("\n");
  expect(speakersOf(html)).toEqual(["Anna", "Tom", "Anna-Lena", "Vater von Tom"]);
});

test("labels in mixed case before what is said count too; headings, sentence openings, letters and the learner's language do not", () => {
  const html = [
    "<p>Am Bahnhof:</p><p>Der Zug kommt gleich.</p>",
    "<p>Beispiel: Ich komme aus Graz.</p>",
    "<p>Erzähler: Es ist Montag.</p>",
    "<p>Frau: Guten Abend!</p>",
    "<p>Mann: Guten Abend. Wie geht es Ihnen?</p>",
    "<p>Frau: Danke, gut.</p>",
    "<p>Mann: Schön.</p>",
    "<p>Hier: dein Schlüssel.</p>",
    "<p>A: Wo ist der Bus?</p><p>B: Dort.</p><p>A: Danke.</p><p>B: Bitte.</p>",
    "<p>Пример: Ich heiße Ada.</p><p>Пример: Du heißt Ben.</p>",
    "<p>Max: Bis morgen!</p><p>MAX: Tschüss.</p>",
  ].join("\n");
  expect(speakersOf(html)).toEqual(["Frau", "Mann", "Max"]);
});
