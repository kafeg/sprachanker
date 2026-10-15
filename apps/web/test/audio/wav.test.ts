import { expect, test } from "bun:test";
import { encodeWav, trimSilence } from "../../src/audio/wav.ts";

test("a take as 16 kHz mono 16-bit WAV: the header the recogniser reads, samples clipped to range", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 2]));
  const view = new DataView(wav.buffer);
  const text = (at: number) => String.fromCharCode(...wav.slice(at, at + 4));
  expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
  expect([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([
    1, 16_000, 16,
  ]);
  expect(view.getUint32(40, true)).toBe(8);
  expect([1, 2, 3, 4].map((i) => view.getInt16(42 + i * 2, true))).toEqual([
    0, 32767, -32768, 32767,
  ]);
});

test("a course's recording as the voice for words takes it: the silence at either end cut, a little kept", () => {
  const rate = 100;
  const samples = new Float32Array(300);
  samples.fill(0.5, 100, 150);
  const trimmed = trimSilence(samples, rate);
  // 0.15 s of silence kept on either side of the half second said.
  expect(trimmed.length).toBe(15 + 50 + 15);
  expect(trimmed[15]).toBe(0.5);
  // Nothing louder than silence: kept as it is.
  expect(trimSilence(new Float32Array(10), rate).length).toBe(10);
  expect(new DataView(encodeWav(trimmed, 24_000).buffer).getUint32(24, true)).toBe(24_000);
});
