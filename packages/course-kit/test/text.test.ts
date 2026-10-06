import { expect, test } from "bun:test";
import { decodeEntities, plainLines, plainText } from "../src/text.ts";

test("plain text and lines", () => {
  expect(plainText("<p>Guten&nbsp;Tag,&#160;Herr&rsquo;s </p>")).toBe("Guten Tag, Herr’s");
  expect(
    plainText(
      `<p>Ins <span>Zentrum</span> , <b>bitte</b>.</p><p>( Ja )<span>Appetit</span><span>auf</span> ... und</p>`,
    ),
  ).toBe("Ins Zentrum, bitte. (Ja) Appetit auf ... und");
  expect(plainLines("<p>A: #p#.<br />B: Danke!</p><p>C: Gut.</p>")).toBe(
    "A: #p#.\nB: Danke!\nC: Gut.",
  );
});

test("entities: references and known names decoded, unknown names kept", () => {
  expect(decodeEntities("a&#x27;b&#39;c &amp; &quot;d&quot; &bogus;")).toBe(`a'b'c & "d" &bogus;`);
});
