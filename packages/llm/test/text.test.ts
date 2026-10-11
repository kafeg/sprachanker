import { expect, test } from "bun:test";
import { htmlToText } from "../src/text.ts";

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
