import { expect, test } from "bun:test";
import { encodeWav } from "../../src/audio/wav.ts";

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
