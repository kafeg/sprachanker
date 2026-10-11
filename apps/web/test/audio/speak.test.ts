import { expect, test } from "bun:test";
import { bestVoice } from "../../src/audio/speak.ts";

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
