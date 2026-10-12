import { expect, test } from "bun:test";
import { castVoices, nameGender, speakerVoices, voiceGender } from "../src/speech/voices.ts";

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

test("castVoices: each person a voice of their gender, an older one for a senior only, none twice; at random", () => {
  const QWEN = ["ryan", "aiden", "eric", "uncle_fu", "serena", "vivian", "sohee"];
  const people = [
    { name: "Polizist", gender: "m" as const, age: "adult" as const },
    { name: "Touristin", gender: "f" as const, age: "young" as const },
  ];
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const cast = castVoices("qwen", people, QWEN, Math.random);
    expect(["ryan", "aiden", "eric"]).toContain(cast.Polizist as string);
    expect(["serena", "vivian", "sohee"]).toContain(cast.Touristin as string);
    seen.add(cast.Polizist as string);
  }
  // Drawn at random: not always the same voice.
  expect(seen.size).toBeGreaterThan(1);
  const opa = castVoices(
    "qwen",
    [...people, { name: "Opa", gender: "m", age: "senior" }],
    QWEN,
    () => 0,
  );
  expect(opa).toEqual({ Opa: "uncle_fu", Polizist: "ryan", Touristin: "serena" });
  // Two men, one man's voice: the second takes it again rather than a woman's.
  const two = castVoices(
    "piper",
    [
      { name: "Tom", gender: "m", age: "adult" },
      { name: "Max", gender: "m", age: "adult" },
    ],
    ["de_DE-thorsten-medium", "de_DE-eva_k-x_low"],
    () => 0,
  );
  expect(two).toEqual({ Tom: "de_DE-thorsten-medium", Max: "de_DE-thorsten-medium" });
  expect(castVoices("piper", people, [], () => 0)).toEqual({});
  // A voice another person of the text has already is not drawn while another is free.
  expect(
    castVoices("qwen", [people[0] as (typeof people)[number]], QWEN, () => 0, ["ryan"]),
  ).toEqual({
    Polizist: "aiden",
  });
});
