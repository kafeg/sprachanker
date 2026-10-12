import { expect, test } from "bun:test";
import { nameGender, otherSpeaker, voiceGender } from "../../src/audio/voice-genders.ts";

test("a server voice's gender where it is known: Qwen3-TTS's speakers, Piper's voices by name", () => {
  expect(voiceGender("qwen", "1.7b/ryan")).toBe("m");
  expect(voiceGender("qwen", "serena")).toBe("f");
  expect(voiceGender("piper", "de_DE-thorsten-medium")).toBe("m");
  expect(voiceGender("piper", "de_DE-eva_k-x_low")).toBe("f");
  expect(voiceGender("piper", "de_DE-dii-high")).toBe("f");
  expect(voiceGender("piper", "de_DE-miro-high")).toBe("m");
  // Several speakers, or not known: none.
  expect(voiceGender("piper", "de_DE-mls-medium")).toBeUndefined();
});

test("a speaker's gender by name only where it is obvious", () => {
  expect(
    ["Nina", "Frau Weber", "Mrs. Smith", "Jonas", "Herr Schmidt", "Kim", "B"].map(nameGender),
  ).toEqual(["f", "f", "f", "m", "m", undefined, undefined]);
});

test("the other voice reads the speaker the main voice does not suit, else the second to speak", () => {
  // A man's voice reads: Nina, speaking first, by the other one.
  expect(otherSpeaker(["Nina", "Jonas"], "m")).toBe("Nina");
  expect(otherSpeaker(["Jonas", "Nina"], "m")).toBe("Nina");
  // Both women, or not known, or the voice's gender not known: the second.
  expect(otherSpeaker(["Nina", "Anna"], "m")).toBe("Anna");
  expect(otherSpeaker(["A", "B"], "m")).toBe("B");
  expect(otherSpeaker(["Nina", "Jonas"], undefined)).toBe("Jonas");
  expect(otherSpeaker(["Nina"], "m")).toBeUndefined();
});
