import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SAMPLE_LANGUAGES, samplesOf } from "../../src/audio/samples.ts";

/** The languages the engines read: Piper's voices (the server's list) and Qwen3-TTS's. */
const piper: Array<{ lang: string }> = JSON.parse(
  readFileSync(
    new URL("../../../../packages/server/src/services/piper-voices.json", import.meta.url),
    "utf8",
  ),
);
const QWEN = ["de", "en", "ru", "fr", "es", "it", "pt", "zh", "ja", "ko"];

test("every language an engine reads has phrases to listen to, two or more, none empty", () => {
  for (const lang of new Set([...piper.map((v) => v.lang), ...QWEN])) {
    expect(SAMPLE_LANGUAGES).toContain(lang);
  }
  for (const lang of SAMPLE_LANGUAGES) {
    const phrases = samplesOf(lang);
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    for (const p of phrases) expect(p.trim().length).toBeGreaterThan(10);
  }
});

test("phrases found by any form of the language's tag; none for a language without them", () => {
  expect(samplesOf("de-DE")).toEqual(samplesOf("de"));
  expect(samplesOf("pt_BR")).toEqual(samplesOf("pt"));
  expect(samplesOf("nb-NO")).toEqual(samplesOf("no"));
  expect(samplesOf("xx")).toEqual([]);
});
