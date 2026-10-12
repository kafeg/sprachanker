// What of what Whisper heard is the learner's, on takes as measured with the real engines
// (whisper-server, large-v3-turbo): each case is a take's loudness and what Whisper returned for it.
import { expect, test } from "bun:test";
import { type Loudness, said } from "../src/services/silence.ts";

/** A take's loudness: ms at -50 and -40 dBFS, the loudest 20 ms in dBFS, steady or not. */
const take = (speechMs: number, loudMs: number, peakDb: number, steady = false): Loudness => ({
  speechMs,
  loudMs,
  peak: 10 ** (peakDb / 20),
  steady,
});
const hear = (text: string, logprob: number, sound: Loudness, expected?: string[]) =>
  said({ text, logprob }, sound, "de", expected);

test("real short answers are kept at every level the page sends, Whisper sure of them or not", () => {
  // Course speaker, Piper and Qwen3-TTS at ×1, ×0.3, ×0.18, ×0.1.
  expect(hear(" Tschüss!", -0.16, take(460, 440, -14.6))).toBe("Tschüss!");
  expect(hear(" Tschüss!", -0.15, take(180, 100, -34.6))).toBe("Tschüss!");
  expect(hear(" Danke.", -0.01, take(240, 80, -36.8))).toBe("Danke.");
  expect(hear(" Tschüss.", -0.01, take(80, 40, -38.2))).toBe("Tschüss.");
  expect(hear(" Vielen Dank.", -0.01, take(380, 120, -39))).toBe("Vielen Dank.");
  expect(hear(" Tschüss.", -0.14, take(400, 80, -36.4))).toBe("Tschüss.");
  // A learner's accent: Whisper less sure, the same words kept — quiet, or said normally.
  expect(hear(" Danke.", -0.45, take(240, 80, -36.8))).toBe("Danke.");
  expect(hear(" Tschüss.", -0.5, take(80, 40, -38.2))).toBe("Tschüss.");
  expect(hear(" Danke.", -0.7, take(360, 320, -16.8))).toBe("Danke.");
  // Unsure and near-silent, but the line to say.
  expect(hear(" Danke.", -0.7, take(240, 80, -36.8), ["Danke!"])).toBe("Danke.");
});

test("what Whisper makes of silence, noise, breathing and a tap is nothing", () => {
  // Faint noise (-50 dBFS), steady: "Amen." unsure.
  expect(hear(" Amen.", -0.99, take(1960, 0, -49.2, true))).toBe("");
  // Noise at -42 dBFS, steady and near-silent: "Amen." as sure as a word said.
  expect(hear(" Amen.", -0.17, take(4000, 0, -41, true))).toBe("");
  // Pink noise: "Vielen Dank." unsure, steady.
  expect(hear(" Vielen Dank.", -0.69, take(4000, 2100, -32, true))).toBe("");
  // A tap of 160 ms in silence: "Vielen Dank." unsure, loud only briefly.
  expect(hear(" Vielen Dank.", -0.58, take(160, 160, -9))).toBe("");
  // Breathing and hum: a credit, sure of it, at any loudness.
  expect(hear(" Untertitelung des ZDF, 2020", -0.2, take(3080, 600, -37.1))).toBe("");
  expect(hear(" Untertitelung des ZDF, 2020", -0.27, take(4000, 0, -40.1, true))).toBe("");
  // Noise named as a sound, or punctuation alone.
  expect(hear(" * Musik *", -0.16, take(4000, 4000, -33, true))).toBe("");
  expect(hear(" ...", -0.34, take(4000, 0, -41.1, true))).toBe("");
  // Any word Whisper is unsure of in steady noise loud only briefly.
  expect(hear(" Spannungsgeladene", -0.6, take(4000, 0, -41, true))).toBe("");
});

test("in loud steady noise an unsure word may be speech: kept; a made-up phrase still goes", () => {
  expect(hear(" Ich heiße Anna.", -0.6, take(3000, 3000, -24, true))).toBe("Ich heiße Anna.");
  expect(hear(" Vielen Dank.", -0.6, take(3000, 3000, -24, true))).toBe("");
  // Noise at -38 and -25 dBFS heard as a phrase Whisper is sure of.
  expect(hear(" Vielen Dank.", -0.3, take(4000, 4000, -37.1, true))).toBe("");
  expect(hear(" Okay.", -0.48, take(3000, 3000, -24.3, true))).toBe("");
});

test("credits go — a whole one, or one after what was said — but words a credit begins with stay", () => {
  const spoken = take(1500, 1200, -15);
  expect(hear(" Untertitel im Auftrag des ZDF, 2020", -0.2, spoken)).toBe("");
  expect(hear(" Untertitelung des ZDF, 2020", -0.2, spoken)).toBe("");
  expect(hear(" Ich heiße Anna. Untertitel im Auftrag des ZDF, 2020", -0.2, spoken)).toBe(
    "Ich heiße Anna.",
  );
  expect(hear(" Untertitel sind gut.", -0.2, spoken)).toBe("Untertitel sind gut.");
  expect(hear(" Das ZDF zeigt Filme.", -0.2, spoken)).toBe("Das ZDF zeigt Filme.");
  expect(said({ text: " Thanks. Subtitles by the Amara.org community" }, spoken, "en")).toBe(
    "Thanks.",
  );
});

test("sounds Whisper names go when they are all of it or stand apart; parentheses in a sentence stay", () => {
  const spoken = take(1500, 1200, -15);
  expect(hear(" * Musik *", -0.1, spoken)).toBe("");
  expect(hear(" [Applaus] (lacht)", -0.1, spoken)).toBe("");
  expect(hear(" ♪ Musik ♪", -0.1, spoken)).toBe("");
  expect(hear(" (lacht) Ja, gut.", -0.1, spoken)).toBe("Ja, gut.");
  expect(hear(" Ja, gut. * Musik *", -0.1, spoken)).toBe("Ja, gut.");
  expect(hear(" Ich komme (vielleicht) morgen.", -0.1, spoken)).toBe(
    "Ich komme (vielleicht) morgen.",
  );
  // A note without its closing one is no sound named: what follows it is kept.
  expect(hear(" ♪ Alle meine Entchen", -0.1, spoken)).toBe("♪ Alle meine Entchen");
});
