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

/** The pitch range searched (Hz): the lowest men's voices to the highest women's. */
const PITCH = { min: 70, max: 400 };
/** A frame this long (s), and how much of a frame has to repeat to count as voiced. */
const FRAME_S = 0.04;
const VOICED = 0.6;
/** A lag repeating this nearly as well as the best one is taken before it. */
const NEAR_BEST = 0.9;

/** The median pitch of the voiced frames of `samples` (Hz), by autocorrelation; undefined when
 *  none is voiced. Pure: tested without a browser. */
export function medianPitch(samples: Float32Array, rate: number): number | undefined {
  const size = Math.round(FRAME_S * rate);
  const [low, high] = [Math.floor(rate / PITCH.max), Math.ceil(rate / PITCH.min)];
  const found: number[] = [];
  for (let start = 0; start + size + high < samples.length; start += size) {
    let energy = 0;
    for (let i = start; i < start + size; i++) energy += (samples[i] ?? 0) ** 2;
    if (energy / size < QUIET ** 2) continue;
    const sums: number[] = [];
    for (let k = low; k <= high; k++) {
      let sum = 0;
      for (let i = start; i < start + size; i++) sum += (samples[i] ?? 0) * (samples[i + k] ?? 0);
      sums.push(sum);
    }
    const best = Math.max(...sums);
    if (best / energy < VOICED) continue;
    // The shortest lag repeating nearly as well as the best: the period, not a multiple of it.
    const at = sums.findIndex(
      (sum, i) => sum >= NEAR_BEST * best && sum >= (sums[i - 1] ?? 0) && sum >= (sums[i + 1] ?? 0),
    );
    found.push(rate / (low + at));
  }
  found.sort((a, b) => a - b);
  return found.length ? found[Math.floor(found.length / 2)] : undefined;
}

/** A median pitch below this is a man's voice, above the other a woman's; between them it cannot be
 *  told (a low woman's voice, a high man's). */
const MALE_BELOW_HZ = 155;
const FEMALE_ABOVE_HZ = 185;
const PITCH_RATE = 8_000;

/** Whether a recording is said by a man or a woman, by its pitch; undefined when it cannot tell. */
export async function voiceGender(blob: Blob): Promise<"male" | "female" | undefined> {
  const pitch = medianPitch(await decode(blob, PITCH_RATE), PITCH_RATE);
  if (pitch === undefined) return undefined;
  return pitch < MALE_BELOW_HZ ? "male" : pitch > FEMALE_ABOVE_HZ ? "female" : undefined;
}
