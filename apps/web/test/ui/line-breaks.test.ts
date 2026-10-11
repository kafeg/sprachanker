import { expect, test } from "bun:test";
import { keptTogether, keptTogetherHtml } from "../../src/ui/line-breaks.ts";

test("a hyphen stays with the word part it opens or ends; a slash between words may break", () => {
  expect(keptTogether("Wörter auf -ung und -symbole")).toBe("Wörter auf ‑ung und ‑symbole");
  expect(keptTogether("die Endung (e)te- oder -(e)te.")).toBe("die Endung (e)te‑ oder ‑(e)te.");
  // A dash between words and a hyphen inside a word stay as they are.
  expect(keptTogether("Berlin - Hamburg, E-Mail")).toBe("Berlin - Hamburg, E-Mail");
  expect(keptTogether("Führerschein/Computerkenntnisse, 1/2")).toBe(
    "Führerschein/​Computerkenntnisse, 1/2",
  );
});

test("in HTML only the text changes, never a tag", () => {
  expect(keptTogetherHtml('<img src="media/image/a.jpg" alt=""><p>ich/du, nach -te</p>')).toBe(
    '<img src="media/image/a.jpg" alt=""><p>ich/​du, nach ‑te</p>',
  );
});
