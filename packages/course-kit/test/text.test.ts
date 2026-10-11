import { expect, test } from "bun:test";
import { decodeEntities, plainLines, plainText } from "../src/text.ts";

test("plain text and lines", () => {
  expect(plainText("<p>Guten&nbsp;Tag,&#160;Herr&rsquo;s </p>")).toBe("Guten Tag, Herr’s");
  expect(
    plainText(
      `<p>Ins <span>Zentrum</span> , <b>bitte</b>.</p><p>( Ja )<span>Appetit</span><span>auf</span> ... und</p>`,
    ),
  ).toBe("Ins Zentrum, bitte. (Ja) Appetit auf ... und");
  expect(plainText("„ <b>mich</b> “ ist hier")).toBe("„mich“ ist hier");
  expect(plainLines("<p>A: #p#.<br />B: Danke!</p><p>C: Gut.</p>")).toBe(
    "A: #p#.\nB: Danke!\nC: Gut.",
  );
  // An editor's markup in a comment, over several lines, is not text.
  const word =
    'Gut!<!--[if gte vml 1]><v:shapetype\n id="t75" o:spt="75">\n <v:f eqn="x"></v:f>\n</v:shapetype><![endif]--> Ja.';
  expect(plainLines(`<p>A: ${word}<br>B: Nein.</p>`)).toBe("A: Gut! Ja.\nB: Nein.");
  expect(plainText(word)).toBe("Gut! Ja.");
});

test("entities: references and known names decoded, unknown names kept", () => {
  expect(decodeEntities("a&#x27;b&#39;c &amp; &quot;d&quot; &bogus;")).toBe(`a'b'c & "d" &bogus;`);
  // What the sources write: a joiner inside a Persian word stays one, a wide space is a space.
  expect(decodeEntities("25 &deg;C &iquest;Qu&eacute;? زندگی&zwnj;نامه")).toBe(
    "25 °C ¿Qué? زندگی\u200cنامه",
  );
  expect(plainText("these&emsp;–&emsp;those")).toBe("these – those");
  // Characters of no width are no text: neither a space nor a part of a word.
  expect(plainText("Mann: \u200b\u200bFalsch!\ufeff")).toBe("Mann: Falsch!");
});
