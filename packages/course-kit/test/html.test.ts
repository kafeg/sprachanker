import { expect, test } from "bun:test";
import { escapeHtml, sanitizeCourseHtml } from "../src/html.ts";

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
