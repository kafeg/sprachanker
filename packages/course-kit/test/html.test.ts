import { expect, test } from "bun:test";
import { boldLinesAsHeadings, escapeHtml, sanitizeCourseHtml } from "../src/html.ts";

const options = {
  image: (a: Record<string, string>) =>
    a["data-id"] ? (`media/image/${a["data-id"]}.jpg` as never) : undefined,
  drop: (tag: string, a: Record<string, string>) => tag === "small" && a.class === "copyright",
};

test("keeps allowed structure, strips attributes and scripts, unwraps the rest", () => {
  const html = `<p style="x">Hallo <span class="placeholder" data-id="1">Frau</span>!</p>
<script>alert(1)</script><table border="1"><tbody><tr><td onclick="x">a</td></tr></tbody></table>
<a href="https://x.test">link</a><p></p>`;
  expect(sanitizeCourseHtml(html, options)).toBe(
    "<p>Hallo Frau!</p>\n<table><tbody><tr><td>a</td></tr></tbody></table>\nlink",
  );
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

test("a no-break space between letters wraps; one by a number or a mark stays", () => {
  expect(
    sanitizeCourseHtml("<p>gesunden\u00a0und\u00a0leckeren 25\u00a0°C Bonjour\u00a0!</p>", {
      image: () => undefined,
    }),
  ).toBe("<p>gesunden und leckeren 25\u00a0°C Bonjour\u00a0!</p>");
});
