// A dialogue's other speaker read on the device (08): another voice of the language, of the speaker's
// gender where the voices' names say theirs.
import { expect, test } from "bun:test";
import { deviceVoiceGender, otherVoice } from "../../src/audio/speaker.ts";

const voice = (name: string, lang = "de-DE") =>
  ({ name, lang, voiceURI: name, localService: true, default: false }) as SpeechSynthesisVoice;

test("another device voice of the speaker's gender, by its name; any other where none is", () => {
  const anna = voice("Anna");
  const voices = [anna, voice("Helena (Enhanced)"), voice("Markus"), voice("Samantha", "en-US")];
  expect(deviceVoiceGender(voices[1] as SpeechSynthesisVoice)).toBe("f");
  expect(otherVoice(voices, anna, "de", "m")?.name).toBe("Markus");
  expect(otherVoice(voices, anna, "de", "f")?.name).toBe("Helena (Enhanced)");
  expect(otherVoice([anna, voice("Helena")], anna, "de", "m")?.name).toBe("Helena");
  expect(otherVoice([anna], anna, "de", "m")).toBeUndefined();
});
