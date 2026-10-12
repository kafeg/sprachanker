import { expect, test } from "bun:test";
import { writingTaskTask } from "../src/tasks/writing-task.ts";
import { htmlToText, mixedWord, writtenIn } from "../src/text.ts";

test("mixedWord: a word of two alphabets alike (a real explanation's «Вопрos»); names and words apart are no mix", () => {
  expect(
    mixedWord(["Правильный ответ — «Nicht alle». Вопрos спрашивает, что именно Лиза критикует."]),
  ).toBe("Вопрos");
  expect(
    mixedWord(["После mit — дательный падеж: mit der Kamerafrau.", "Lisa и Tom в Берлине."]),
  ).toBeUndefined();
  expect(mixedWord(["柏林的Lisa", "Felixʼ Hund"])).toBeUndefined();
  // A task's words to the learner: asked again once, before their gender.
  const lesson = { title: "Schule", goals: [], grammarHtml: [], vocab: [] };
  const task = writingTaskTask({ language: "ru", target: "de", lesson });
  const reply = {
    situation: "Друг пишет тебе.",
    points: ["Напиши, что ты решил.", "Объясни почему.", "Предложи встречу."],
  };
  expect(task.quality?.({ ...reply, situation: "Друг пиshет тебе." })).toContain(
    '"пиshет" mixes two alphabets',
  );
  expect(task.quality?.(reply)).toContain("ты решил");
});

test("writtenIn: a fifth of the words in the language's script make a text its, a Chinese character a word", () => {
  // Names in the other script beside the text do not make it the other's.
  expect(writtenIn("柏林的Lisa和Tom", "zh", "de")).toBe(true);
  expect(writtenIn("Lisa und Tom в Берлине", "ru", "de")).toBe(true);
  expect(writtenIn("बर्लिन में Lisa und Tom", "hi", "de")).toBe(true);
  // Absent or a lone word among many: the other language's.
  expect(writtenIn("Beim Bäcker. Anna kauft Brötchen.", "ru", "de")).toBe(false);
  expect(
    writtenIn("Anna kauft heute Morgen drei frische Brötchen und Kaffee: хлеб", "ru", "de"),
  ).toBe(false);
  expect(writtenIn("Anna kauft Brötchen.", "zh", "de")).toBe(false);
  // Scripts alike, or no word in either: not told.
  expect(writtenIn("Beim Bäcker", "en", "de")).toBeUndefined();
  expect(writtenIn("12:30", "ru", "de")).toBeUndefined();
});

// Shaped like a conjugation table of a course's grammar notes: indented source, a header row, letters
// marked one by one, a row label with an empty cell, a cell with paragraphs, an empty row.
const conjugation = `<p>Unregelmäßige Verben:</p>
<table>
\t<tbody>
\t\t<tr>
\t\t\t<th><strong>Präteritum</strong></th>
\t\t\t<th><strong>Konjunktiv II</strong></th>
\t\t</tr>
\t\t<tr>
\t\t\t<td>ich war</td>
\t\t\t<td><em>ich w</em><strong>ä</strong><em>r</em><strong>e</strong></td>
\t\t</tr>
\t\t<tr>
\t\t\t<td><em>Plural:</em></td>
\t\t\t<td>&nbsp;</td>
\t\t</tr>
\t\t<tr>
\t\t\t<td>wir waren</td>
\t\t\t<td><p>wir w<strong>ä</strong>ren</p><p>(selten: wir wär<strong>e</strong>n)</p></td>
\t\t</tr>
\t\t<tr><td> </td><td></td></tr>
\t</tbody>
</table>
<p>* Manchmal: <em>du wärest</em>.</p>`;

test("htmlToText: a table's row is one line of its cells, the header once, no stray separators", () => {
  expect(htmlToText(conjugation)).toBe(
    [
      "Unregelmäßige Verben:",
      "",
      "Präteritum · Konjunktiv II",
      "ich war · ich wäre",
      "Plural:",
      "wir waren · wir wären (selten: wir wären)",
      "",
      "* Manchmal: du wärest.",
    ].join("\n"),
  );
});
