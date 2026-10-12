import { expect, test } from "bun:test";
import { nameGender, speakerVoices, voiceGender } from "../../src/audio/voice-genders.ts";

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

test("each speaker by a voice of their gender: the main voice reads the one it suits, else the first not known", () => {
  // A man's voice reads Jonas; Nina, speaking first or not, a woman's voice.
  expect(speakerVoices(["Nina", "Jonas"], "m")).toEqual({ Nina: "f" });
  expect(speakerVoices(["Jonas", "Nina"], "m")).toEqual({ Nina: "f" });
  // Two women and a man's voice: neither by it — the first a woman's voice, the second another's.
  expect(speakerVoices(["Nina", "Anna"], "m")).toEqual({ Nina: "f", Anna: "f2" });
  // A woman's voice and two women: it reads the first, another woman's voice the second.
  expect(speakerVoices(["Nina", "Anna"], "f")).toEqual({ Anna: "f" });
  // Not known: the main voice reads the first not known, the other any other voice.
  expect(speakerVoices(["A", "B"], "m")).toEqual({ B: true });
  expect(speakerVoices(["Nina", "B"], "m")).toEqual({ Nina: "f" });
  // The main voice's gender not known: it reads the first to speak.
  expect(speakerVoices(["Nina", "Jonas"], undefined)).toEqual({ Jonas: "m" });
  expect(speakerVoices(["Nina"], "m")).toEqual({});
});
