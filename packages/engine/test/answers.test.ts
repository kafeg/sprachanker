import { expect, test } from "bun:test";
import type { Exercise } from "@sprachanker/schema";
import { answerComplete, isChecked, linesToSay, spokenFreely } from "../src/index.ts";

const ex = (type: string, items: unknown[]) =>
  ({ key: "s/c/00-01/ex-01", type, items }) as unknown as Exercise;

test("checked: everything but speaking oneself and unknown mechanics", () => {
  expect(
    ["single_choice", "respond", "dictation", "speech_repeat"].map((t) => isChecked(t as never)),
  ).toEqual([true, true, true, true]);
  expect(["speech_selfrate", "unknown"].map((t) => isChecked(t as never))).toEqual([false, false]);
});

test("complete enough to check: every pair and part, one typed gap, text typed", () => {
  const match = ex("match", [{ left: [{ id: "a" }, { id: "b" }] }]);
  expect(answerComplete(match, 0, { pairs: [["a", "x"]] })).toBe(false);
  expect(
    answerComplete(match, 0, {
      pairs: [
        ["a", "x"],
        ["b", "y"],
      ],
    }),
  ).toBe(true);
  const gaps = ex("gap_text", [{ segments: ["a", { gap: "g1" }, { gap: "g2" }] }]);
  expect(answerComplete(gaps, 0, { g1: " ", g2: "" })).toBe(false);
  expect(answerComplete(gaps, 0, { g1: "der", g2: "" })).toBe(true);
  expect(answerComplete(ex("respond", [{}]), 0, { text: "  " })).toBe(false);
  expect(answerComplete(ex("single_choice", [{}]), 0, undefined)).toBe(false);
  // A phrase said and nothing heard: no answer to check yet.
  const say = ex("speech_repeat", [{ text: "Hallo!" }]);
  expect(answerComplete(say, 0, { speech: { transcript: " " } })).toBe(false);
  expect(answerComplete(say, 0, { speech: { transcript: "hallo" } })).toBe(true);
});

test("what was heard of an answer said aloud with no phrase to say", () => {
  const speaking = ex("speech_selfrate", [{ text: "Guten Tag!" }, {}]);
  expect(spokenFreely(speaking, 1, { transcript: "Hallo" })).toBe("Hallo");
  expect(spokenFreely(speaking, 1, { transcript: " " })).toBeUndefined();
  expect(spokenFreely(speaking, 0, { transcript: "Guten Tag" })).toBeUndefined();
  expect(spokenFreely(ex("respond", [{}]), 0, { transcript: "Hallo" })).toBeUndefined();
});

test("a speaking item's line to say: the source's answer, else its phrase; a frame leaves it open", () => {
  // The source's answer, not the question heard; its alternatives each a line.
  expect(
    linesToSay({
      text: "Warst du schon in Berlin?",
      reference: ["Ja, ich war schon in Berlin. / Nein, ich war noch nie in Berlin."],
    }),
  ).toEqual(["Ja, ich war schon in Berlin.", "Nein, ich war noch nie in Berlin."]);
  expect(linesToSay({ text: "Guten Tag!" })).toEqual(["Guten Tag!"]);
  // A frame, words to use, nothing: the answer is the learner's own.
  for (const reference of ["Ja, ich … / Nein, ich …", "Ich trinke ...", "(seit – zwei Monate)"])
    expect(linesToSay({ reference: [reference] })).toBeUndefined();
  expect(linesToSay({})).toBeUndefined();
  // A spelled answer is no words to diff.
  expect(linesToSay({ reference: ["E-M-M-A"] })).toBeUndefined();
  expect(linesToSay({ reference: ["Mein Name: G-O-N-Z-A-L-E-Z"] })).toBeUndefined();
  expect(linesToSay({ reference: ["Ich schreibe eine E-Mail im U-Bahn-Zug."] })).toEqual([
    "Ich schreibe eine E-Mail im U-Bahn-Zug.",
  ]);
  const speaking = ex("speech_selfrate", [
    { reference: ["Ja, ich habe ..."] },
    { reference: ["Ich habe zwei Brüder."] },
  ]);
  expect(spokenFreely(speaking, 0, { transcript: "Ja, ich habe eine Schwester" })).toBe(
    "Ja, ich habe eine Schwester",
  );
  expect(spokenFreely(speaking, 1, { transcript: "Ich habe zwei Brüder" })).toBeUndefined();
});

test("a phrase to repeat is said as written: brackets are its words, alternatives only on one line", () => {
  // Words in brackets are read (optional words, a stage direction): no frame.
  for (const text of [
    "I’m pretty busy these days.\nI’m pretty sure (that) you weren’t there.",
    "D: — (laughs) Going somewhere?\nN: — Hey, Eddy!",
    "The movie (had) started before we arrived.",
    "I wish I were lying on the beach...\nSo, let me get this straight...",
  ])
    expect(linesToSay({ text })).toEqual([text]);
  // One line's " / " are its alternatives; several lines are read whole, their " / " inside them.
  expect(linesToSay({ text: "Muss sie das sein? / Muss er das sein?" })).toEqual([
    "Muss sie das sein?",
    "Muss er das sein?",
  ]);
  const lines = "Is there anybody in the room?\nYes, there is. / No, there is not.";
  expect(linesToSay({ text: lines })).toEqual([lines]);
  expect(linesToSay({ text: "Every day / week / month\nNever" })).toEqual([
    "Every day / week / month\nNever",
  ]);
});
