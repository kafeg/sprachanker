// A take as the recogniser wants it: 16 kHz, mono, 16-bit PCM WAV, made in the browser (decoded
// and resampled with WebAudio) so the server needs no converter; a course's recording as the voice for
// words is taken from (24 kHz, its silence at either end cut).

const RATE = 16_000;
/** What Qwen3-TTS clones a voice from. */
const VOICE_RATE = 24_000;

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

/** A recording decoded and resampled to `rate`, mono. */
async function decode(blob: Blob, rate: number): Promise<Float32Array> {
  // Decoded offline: no audio device is opened (a realtime context may fail to start, and a page
  // may hold only a few).
  const decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(
    await blob.arrayBuffer(),
  );
  const length = Math.max(1, Math.ceil(decoded.duration * rate));
  const offline = new OfflineAudioContext(1, length, rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** A recording, decoded and resampled to 16 kHz mono, as WAV. */
export const toWav16k = async (blob: Blob) => encodeWav(await decode(blob, RATE));

/** Below this a sample is silence (about -40 dB). */
const QUIET = 0.01;
/** Kept of the silence on either side of the speech. */
const MARGIN_S = 0.15;

/** The samples without the silence at either end (a course's recording pauses after the sentence
 *  for the learner to repeat it), a little of it kept; all of them when nothing is louder. */
export function trimSilence(samples: Float32Array, rate: number): Float32Array {
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start] ?? 0) < QUIET) start++;
  while (end > start && Math.abs(samples[end - 1] ?? 0) < QUIET) end--;
  if (start >= end) return samples;
  const margin = Math.round(MARGIN_S * rate);
  return samples.subarray(Math.max(0, start - margin), Math.min(samples.length, end + margin));
}

/** A course's recording as the voice for words is taken from: 24 kHz mono WAV, its silence cut. */
export const toVoiceWav = async (blob: Blob) =>
  encodeWav(trimSilence(await decode(blob, VOICE_RATE), VOICE_RATE), VOICE_RATE);
