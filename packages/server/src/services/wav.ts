// WAV readings joined into one (08): Listening's text as one recording — its lines read by their
// people's voices, a pause between them — so the page plays it in the course's own player, with its
// timeline and speed. 16-bit PCM only (what Piper and Qwen3-TTS give); readings at another rate are
// brought to the first's, several channels to one.

/** A 16-bit PCM WAV's samples (mono) and rate; undefined for anything else. */
export function readWav(wav: Uint8Array): { rate: number; samples: Int16Array } | undefined {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) =>
    at + 4 <= wav.length ? String.fromCharCode(...wav.subarray(at, at + 4)) : "";
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return undefined;
  let format: { channels: number; rate: number; bits: number; pcm: boolean } | undefined;
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (tag(at) === "fmt " && size >= 16)
      format = {
        pcm: view.getUint16(body, true) === 1,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    if (tag(at) === "data") {
      if (!format?.pcm || format.bits !== 16 || !format.channels || !format.rate) return undefined;
      const end = Math.min(wav.length, body + size);
      const frames = Math.floor((end - body) / (2 * format.channels));
      const samples = new Int16Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < format.channels; c++)
          sum += view.getInt16(body + (f * format.channels + c) * 2, true);
        samples[f] = Math.round(sum / format.channels);
      }
      return { rate: format.rate, samples };
    }
    at = body + size + (size % 2);
  }
  return undefined;
}

/** Samples at `from` Hz brought to `to` Hz (linear). */
function resample(samples: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return samples;
  const out = new Int16Array(Math.round((samples.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const x = (i * from) / to;
    const a = Math.floor(x);
    const t = x - a;
    out[i] = Math.round((samples[a] ?? 0) * (1 - t) + (samples[a + 1] ?? samples[a] ?? 0) * t);
  }
  return out;
}

/** A mono 16-bit PCM WAV of samples at a rate. */
export function writeWav(samples: Int16Array, rate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i] ?? 0, true);
  return bytes;
}

/** Readings joined, each followed by its pause (ms) — at the first reading's rate. A reading that
 *  is no 16-bit PCM WAV is left out; none, undefined. */
export function joinWavs(parts: Array<{ wav: Uint8Array; pauseMs: number }>) {
  const read = parts.flatMap((p) => {
    const wav = readWav(p.wav);
    return wav ? [{ ...wav, pauseMs: p.pauseMs }] : [];
  });
  const rate = read[0]?.rate;
  if (!rate) return undefined;
  const pieces = read.flatMap((r) => [
    resample(r.samples, r.rate, rate),
    new Int16Array(Math.round((rate * r.pauseMs) / 1000)),
  ]);
  const all = new Int16Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    all.set(p, at);
    at += p.length;
  }
  return writeWav(all, rate);
}
