// A take as the recogniser wants it (08): 16 kHz, mono, 16-bit PCM WAV, made in the browser (decoded
// and resampled with WebAudio) so the server needs no converter.

const RATE = 16_000;

/** PCM samples (-1…1) as a WAV file. */
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array<ArrayBuffer> {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  out.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, 1, true); // mono
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => {
    const s = Math.max(-1, Math.min(1, v));
    out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  });
  return new Uint8Array(out.buffer);
}

/** A recording, decoded and resampled to 16 kHz mono, as WAV. */
export async function toWav16k(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  // Decoded offline: no audio device is opened (a realtime context may fail to start, and a page
  // may hold only a few).
  const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(
    await blob.arrayBuffer(),
  );
  const length = Math.max(1, Math.ceil(decoded.duration * RATE));
  const offline = new OfflineAudioContext(1, length, RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0));
}
