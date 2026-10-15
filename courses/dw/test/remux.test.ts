import { expect, test } from "bun:test";
import { demuxSegment, mp4Header, newDemuxer } from "../src/remux.ts";
import { segmentUrls } from "../src/stream.ts";

// A synthetic MPEG-TS segment: a PAT, a PMT naming an H.264 and an AAC stream, two video frames (a key
// frame with SPS/PPS, then another) and one audio PES of two ADTS frames. The bytes are made up.
const PMT = 0x1000;
const VIDEO = 0x100;
const AUDIO = 0x101;

function packets(pid: number, payload: Uint8Array, table = false) {
  const out: number[] = [];
  let at = 0;
  let first = true;
  const data = table ? [0, ...payload] : [...payload];
  while (at < data.length || first) {
    const chunk = data.slice(at, at + 184);
    at += 184;
    const fill = 184 - chunk.length;
    const head = [0x47, (first ? 0x40 : 0) | (pid >> 8), pid & 0xff];
    if (fill > 0) {
      // An adaptation field of stuffing before the last, short payload.
      head.push(0x30, fill - 1, ...(fill > 1 ? [0, ...new Array(fill - 2).fill(0xff)] : []));
    } else head.push(0x10);
    out.push(...head, ...chunk);
    first = false;
  }
  return out;
}

const pts = (value: number, marker: number) => [
  (marker << 4) | (((value / 2 ** 30) & 7) << 1) | 1,
  (value >> 22) & 0xff,
  (((value >> 15) & 0x7f) << 1) | 1,
  (value >> 7) & 0xff,
  ((value & 0x7f) << 1) | 1,
];

const pes = (stream: number, time: number, body: number[]) => [
  0,
  0,
  1,
  stream,
  0,
  0,
  0x80,
  0x80,
  5,
  ...pts(time, 2),
  ...body,
];

const nal = (type: number, ...rest: number[]) => [0, 0, 0, 1, type, ...rest];
const adts = (raw: number[]) => {
  const length = raw.length + 7;
  // AAC LC (profile 1), 44.1 kHz (index 4), stereo, no CRC.
  return [
    0xff,
    0xf1,
    (1 << 6) | (4 << 2) | 0,
    (2 << 6) | (length >> 11),
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc,
    ...raw,
  ];
};

function segment(
  audio: number[][] = [pes(0xc0, 9000, [...adts([7, 7, 7]), ...adts([8, 8])])],
  audioType = 0x0f,
  videoAt = [9000, 12600],
) {
  const pat = [0x00, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | (PMT >> 8), PMT & 0xff, 0, 0, 0, 0];
  const pmt = [
    0x02,
    0xb0,
    23,
    0,
    1,
    0xc1,
    0,
    0,
    0xe1,
    0x00,
    0xf0,
    0,
    0x1b,
    0xe0 | (VIDEO >> 8),
    VIDEO & 0xff,
    0xf0,
    0,
    audioType,
    0xe0 | (AUDIO >> 8),
    AUDIO & 0xff,
    0xf0,
    0,
    0,
    0,
    0,
    0,
  ];
  const key = [
    ...nal(0x09, 0xf0),
    ...nal(0x67, 0x42, 0xc0, 0x1e, 1),
    ...nal(0x68, 0xce),
    ...nal(0x65, 1, 2, 3),
  ];
  const next = [...nal(0x09, 0xf0), ...nal(0x41, 4, 5)];
  return new Uint8Array([
    ...packets(0, new Uint8Array(pat), true),
    ...packets(PMT, new Uint8Array(pmt), true),
    ...packets(VIDEO, new Uint8Array(pes(0xe0, videoAt[0] as number, key))),
    ...audio.flatMap((p) => packets(AUDIO, new Uint8Array(p))),
    ...packets(VIDEO, new Uint8Array(pes(0xe0, videoAt[1] as number, next))),
  ]);
}

test("a TS segment's frames: H.264 as lengths and NAL units (no AUD, SPS, PPS), AAC without ADTS", () => {
  const d = newDemuxer(640, 360);
  const frames = demuxSegment(d, segment());
  expect(frames.map((f) => [f.kind, f.seconds])).toEqual([
    ["video", 0.1],
    ["audio", 0.1],
    ["audio", (4410 + 1024) / 44100],
    ["video", 0.14],
  ]);
  expect([...(frames[0]?.bytes ?? [])]).toEqual([0, 0, 0, 4, 0x65, 1, 2, 3]);
  expect([...(frames[1]?.bytes ?? [])]).toEqual([7, 7, 7]);
  expect(d.video?.samples.map((s) => [s.dts, s.key])).toEqual([
    [9000, true],
    [12600, false],
  ]);
  expect([...(d.video?.sps ?? [])]).toEqual([0x67, 0x42, 0xc0, 0x1e, 1]);
  // AAC LC, 44.1 kHz, two channels.
  expect([...(d.audio?.config ?? [])]).toEqual([0x12, 0x10]);
});

test("the MP4's head: ftyp, moov, mdat; each frame's offset where it is written after the head", () => {
  const d = newDemuxer(640, 360);
  const frames = demuxSegment(d, segment());
  const data = frames.reduce((n, f) => n + f.bytes.length, 0);
  const head = mp4Header(
    d,
    frames.map((f) => f.kind),
    data,
  );
  const view = new DataView(head.buffer);
  const types: string[] = [];
  for (let at = 0; at < head.length; at += view.getUint32(at))
    types.push(new TextDecoder().decode(head.subarray(at + 4, at + 8)));
  expect(types).toEqual(["ftyp", "moov", "mdat"]);
  expect(view.getUint32(head.length - 8)).toBe(8 + data);
  // The first chunk offsets of the video and audio tracks: the first frame, and the one after it.
  const text = new TextDecoder("latin1").decode(head);
  const stco = [...text.matchAll(/stco/g)].map((m) => view.getUint32((m.index ?? 0) + 12));
  expect(stco).toEqual([head.length, head.length + (frames[0]?.bytes.length ?? 0)]);
});

test("a sound frame begun at one PES's end and finished in the next keeps its time", () => {
  const second = adts([8, 8]);
  const d = newDemuxer(640, 360);
  const frames = demuxSegment(
    d,
    segment([
      pes(0xc0, 9000, [...adts([7, 7, 7]), ...second.slice(0, 4)]),
      pes(0xc0, 13180, [...second.slice(4), ...adts([9])]),
    ]),
  );
  const sound = frames.filter((f) => f.kind === "audio");
  expect(sound.map((f) => [...f.bytes])).toEqual([[7, 7, 7], [8, 8], [9]]);
  expect(d.audio?.samples.map((s) => s.dts)).toEqual([4410, 4410 + 1024, 4410 + 2048]);
});

test("times go on across the 33-bit wrap", () => {
  const d = newDemuxer(640, 360);
  const near = 2 ** 33 - 7200;
  demuxSegment(d, segment([pes(0xc0, near, adts([7]))], 0x0f, [near, near + 3600]));
  const after = demuxSegment(d, segment([pes(0xc0, 900, adts([8]))], 0x0f, [900, 4500]));
  // Each a moment after the wrap, none back at its start.
  expect(after.map((f) => Math.round(f.seconds * 90_000 - 2 ** 33))).toEqual([900, 900, 4500]);
});

test("a stream whose sound is not AAC in ADTS, or a playlist not one plain run, is refused", () => {
  expect(() => demuxSegment(newDemuxer(640, 360), segment([], 0x03))).toThrow("not AAC");
  expect(() =>
    segmentUrls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\na.ts\n', "https://x.test/"),
  ).toThrow("EXT-X-KEY");
  expect(segmentUrls("#EXTM3U\n#EXTINF:6,\na.ts\n", "https://x.test/v/")).toEqual([
    "https://x.test/v/a.ts",
  ]);
});
