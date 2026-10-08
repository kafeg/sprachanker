import { expect, test } from "bun:test";
import { bestVoice, speakable, splitByScript } from "../../src/audio/speak.ts";

test("a model's Markdown said without its markup", () => {
  expect(
    speakable("## Tipp\n- **Ich heiße** Anna → `heißen`\n- see [the lesson](https://x.test/l)"),
  ).toBe("Tipp\nIch heiße Anna , heißen\nsee the lesson");
});

test("a reply mixing Russian and German: each run in its own language, punctuation kept with it", () => {
  expect(
    splitByScript('Скажи: «Ich heiße Anna.» Это значит "меня зовут Анна".', ["ru", "de"], "ru"),
  ).toEqual(
    [
      { text: "Скажи: «", lang: "ru" },
      { text: "Ich heiße Anna.» ", lang: "de" },
      { text: 'Это значит "меня зовут Анна".', lang: "ru" },
    ].map((p) => ({ ...p, text: p.text.trim() })),
  );
  // One script for both (English and German): one part in the main language.
  expect(splitByScript("Say: Ich heiße Anna.", ["en", "de"], "en")).toEqual([
    { text: "Say: Ich heiße Anna.", lang: "en" },
  ]);
  expect(splitByScript("  ", ["ru", "de"], "ru")).toEqual([]);
});

test("the best voice of a language: high quality in its main region first, never a novelty voice", () => {
  const voices = [
    { id: "eddy", name: "Eddy (Deutsch (Deutschland))", lang: "de-DE", local: true },
    { id: "anna", name: "Anna", lang: "de-DE", local: true },
    { id: "petra", name: "Petra (Enhanced)", lang: "de-DE", local: true },
    { id: "google", name: "Google Deutsch", lang: "de-DE" },
    { id: "at", name: "Jonas (Premium)", lang: "de_AT", local: true },
    { id: "milena", name: "Milena", lang: "ru-RU", local: true },
  ];
  // Enhanced in Germany before Premium in Austria; Premium in Germany before both.
  expect(bestVoice(voices, "de")?.id).toBe("petra");
  expect(bestVoice([...voices, { id: "p", name: "Anna (Premium)", lang: "de-DE" }], "de")?.id).toBe(
    "p",
  );
  expect(bestVoice(voices.slice(0, 2), "de")?.id).toBe("anna");
  expect(bestVoice(voices, "ru")?.id).toBe("milena");
  expect(bestVoice(voices, "fr")).toBeUndefined();
});
