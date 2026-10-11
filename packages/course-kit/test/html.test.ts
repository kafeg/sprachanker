import { expect, test } from "bun:test";
import { boldLinesAsHeadings, escapeHtml, sanitizeCourseHtml, tidySpacing } from "../src/html.ts";

test("spacing an editor left is tidied: one space, none before marks, inside „ “, after ( or at a line's edges", () => {
  expect(
    tidySpacing(
      "<p> Посмотри  видео .&nbsp; Was? „ ja “ ( nein ) <strong>Morgen </strong>. Ja ... und </p><p> </p>",
    ),
  ).toBe("<p>Посмотри видео. Was? „ja“ (nein) <strong>Morgen</strong>. Ja ... und</p>");
  expect(tidySpacing("<p>Line one <br />\nLine two</p>")).toBe("<p>Line one<br />\nLine two</p>");
  expect(tidySpacing("<p>Bonjour ! Oui .</p>", { french: true })).toBe("<p>Bonjour ! Oui.</p>");
  // A run with a no-break space before a French mark stays one.
  expect(tidySpacing("<p>Allemagne\u00a0 ?</p>", { french: true })).toBe("<p>Allemagne\u00a0?</p>");
  // Inside quotes a marked word is a word.
  expect(tidySpacing("<p>mit \u201e<mark>obwohl</mark> \u201c beginnt</p>")).toBe(
    "<p>mit \u201e<mark>obwohl</mark>\u201c beginnt</p>",
  );
  // A quote after a marked word closes it (Arabic writes \u201e \u201c the other way round).
  expect(
    tidySpacing(
      "<p>\u0645\u062b\u0644 \u201c<mark>sich entspannen</mark>\u201e \u062a\u0646\u062a\u0645\u064a</p>",
    ),
  ).toBe(
    "<p>\u0645\u062b\u0644 \u201c<mark>sich entspannen</mark>\u201e \u062a\u0646\u062a\u0645\u064a</p>",
  );
});

test("a mark that does not close the word before it keeps its space: smileys, ellipses, ,, quotes, right-to-left text", () => {
  for (const kept of [
    "<p>Ich bin eingeladen. :-)</p>",
    "<p>Zapamiętaj! :-)</p>",
    '<p>neno ,,habari" ni</p>',
    "<p>است: .Jubiläen</p>",
    "<p>با ... ,Ja</p>",
    "<p>:<em> .</em></p>",
    "<p>كلمة “oder„ في</p>",
    "<p>„Tak” i “nie”</p>",
    "<p>می‌گویند: .99 Cent</p>",
    "<p>„wenn ..., dann ...„ und</p>",
  ])
    expect(tidySpacing(kept)).toBe(kept);
});

const options = {
  image: (a: Record<string, string>) =>
    a["data-id"] ? (`media/image/${a["data-id"]}.jpg` as never) : undefined,
  drop: (tag: string, a: Record<string, string>) => tag === "small" && a.class === "copyright",
};

test("keeps allowed structure, strips attributes and scripts, unwraps the rest", () => {
  const html = `<p style="x">Hallo <span class="placeholder" data-id="1">Frau</span>!</p>
<script>alert(1)</script><table border="1"><tbody><tr><td onclick="x">a</td><td>b</td></tr></tbody></table>
<a href="https://x.test">link</a><p></p>`;
  expect(sanitizeCourseHtml(html, options)).toBe(
    "<p>Hallo Frau!</p>\n<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>\nlink",
  );
  // A word the source marks stays marked; a mark around nothing goes.
  expect(
    sanitizeCourseHtml('<p>Die <mark class="x">Abfahrt</mark><mark></mark>.</p>', options),
  ).toBe("<p>Die <mark>Abfahrt</mark>.</p>");
});

test("a cell keeps its span; a table of one line of text is a bold label", () => {
  const none = { image: () => undefined };
  expect(
    sanitizeCourseHtml(
      '<table><tr><th colspan="2" style="x">Kasus</th></tr><tr><td rowspan="3x">a</td><td rowspan="1">b</td></tr><tr><td rowspan="2">c</td></tr></table>',
      none,
    ),
  ).toBe(
    '<table><tr><th colspan="2">Kasus</th></tr><tr><td>a</td><td>b</td></tr><tr><td rowspan="2">c</td></tr></table>',
  );
  // A case's name in a box of its own over its table: a label; an empty one goes.
  expect(
    sanitizeCourseHtml(
      "<table>\n<tbody>\n<tr>\n<td><strong>Nominativ</strong></td>\n</tr>\n</tbody>\n</table><table><tr><td>&#160;</td></tr></table><table><tr><td>a</td><td>b</td></tr></table>",
      none,
    ),
  ).toBe("<p><strong>Nominativ</strong></p><table><tr><td>a</td><td>b</td></tr></table>");
  // A framed note of paragraphs stays a table.
  const note = "<table><tr><td><p>eins</p><p>zwei</p></td></tr></table>";
  expect(sanitizeCourseHtml(note, none)).toBe(note);
});

test("characters of no width an editor left go", () => {
  expect(sanitizeCourseHtml("<p>\ufeffSchneiden\u200b\u200b Sie</p>", options)).toBe(
    "<p>Schneiden Sie</p>",
  );
  expect(sanitizeCourseHtml("<p>Schneiden&#8203;&#xFEFF; Sie</p>", options)).toBe(
    "<p>Schneiden Sie</p>",
  );
});

test("rewrites images to media paths and drops credits and unknown images", () => {
  const html = `<figure class="big"><img data-id="5" data-url="https://cdn/5_\${formatId}.jpg" alt="Zwei Leute" style="h">
<figcaption>Gruß<small class="copyright">null DW</small></figcaption></figure><img src="https://other/x.png">`;
  expect(sanitizeCourseHtml(html, options)).toBe(
    '<figure><img src="media/image/5.jpg" alt="Zwei Leute" />\n<figcaption>Gruß</figcaption></figure>',
  );
});

test("escapes text for HTML content", () => {
  expect(escapeHtml(`a < b && "c" > d`)).toBe(`a &lt; b &amp;&amp; "c" &gt; d`);
});

test("a paragraph of bold text only becomes a section title; bold inside a sentence stays", () => {
  expect(
    boldLinesAsHeadings(
      "<p><strong>Формальное: </strong></p><p>Das ist <strong>wichtig</strong>.</p><p><b>Neu</b></p><p><strong>A</strong> und <strong>B</strong></p>",
    ),
  ).toBe(
    "<h3>Формальное</h3><p>Das ist <strong>wichtig</strong>.</p><h3>Neu</h3><p><strong>A</strong> und <strong>B</strong></p>",
  );
  // Kept by the sanitiser.
  expect(sanitizeCourseHtml("<h3>Titel</h3><h2>x</h2>", { image: () => undefined })).toBe(
    "<h3>Titel</h3>x",
  );
});

test("empty emphasis, paragraphs and captions go; titles inside tables are bold paragraphs", () => {
  const none = { image: () => undefined };
  expect(
    sanitizeCourseHtml(
      '<p><strong> </strong></p><p>oder<em> </em>und<strong>\u200c</strong></p><p><strong><em></em></strong><br></p><figure><figcaption><small class="copyright">DW</small></figcaption></figure>',
      { ...none, drop: options.drop },
    ),
  ).toBe("<p>oder und<strong>\u200c</strong></p><figure></figure>");
  expect(
    sanitizeCourseHtml(
      "<h3>Kasus</h3><table><tr><td><h3>Nominativ: -</h3></td></tr></table>",
      none,
    ),
  ).toBe("<h3>Kasus</h3><table><tr><td><p><strong>Nominativ: -</strong></p></td></tr></table>");
  expect(
    boldLinesAsHeadings(
      "<ul><li><p><strong>eins</strong></p></li></ul><p><strong>Zwei</strong></p>",
    ),
  ).toBe("<ul><li><p><strong>eins</strong></p></li></ul><h3>Zwei</h3>");
});

test("line breaks at a block's edges go, a run of them is one; lines of '- item' are a list", () => {
  const none = { image: () => undefined };
  expect(
    sanitizeCourseHtml(
      "<p><br>\nErstens.<br></p><p><em>a<br><br>\nb<br></em></p><td><p><br>\nc</p></td>",
      none,
    ),
  ).toBe("<p>Erstens.</p><p><em>a<br />\nb</em></p><td><p>c</p></td>");
  expect(sanitizeCourseHtml("<p>Liste<br>\n- eins<br>\n- zwei (A/B)<br>\nEnde</p>", none)).toBe(
    "<p>Liste</p><ul><li>eins</li><li>zwei (A/B)</li></ul><p>Ende</p>",
  );
  // Marked words do not keep lines from being a list.
  expect(sanitizeCourseHtml("<p>- <mark>eins</mark><br>\n- zwei</p>", none)).toBe(
    "<ul><li><mark>eins</mark></li><li>zwei</li></ul>",
  );
  // One dash line is a dash, not a list; emphasis across lines stays as it is.
  for (const kept of ["<p>a<br />\n- b</p>", "<p><em>x</em><br />\n- a<br />\n- b</p>"])
    expect(sanitizeCourseHtml(kept, none)).toBe(kept);
  // Emphasis cut in two with nothing between is one ("(Wer?)" no longer two runs).
  expect(sanitizeCourseHtml("<p>(<em>Wer</em><em>?</em>) <em>a</em> <em>b</em></p>", none)).toBe(
    "<p>(<em>Wer?</em>) <em>a</em> <em>b</em></p>",
  );
});

test("a no-break space between letters wraps; one by a number or a mark stays", () => {
  expect(
    sanitizeCourseHtml("<p>gesunden\u00a0und\u00a0leckeren 25\u00a0°C Bonjour\u00a0!</p>", {
      image: () => undefined,
    }),
  ).toBe("<p>gesunden und leckeren 25\u00a0°C Bonjour\u00a0!</p>");
  // A marked word is still a word.
  expect(
    sanitizeCourseHtml("<p>Der <mark>Zug</mark>\u00a0nach</p>", { image: () => undefined }),
  ).toBe("<p>Der <mark>Zug</mark> nach</p>");
});
