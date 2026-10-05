import { expect, test } from "bun:test";
import { plainLines, plainText } from "../src/text.ts";

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
