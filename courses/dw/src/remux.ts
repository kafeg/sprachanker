// An HLS stream's MPEG-TS segments made one MP4 (H.264 and AAC copied, nothing encoded again), in
// TypeScript: the same on the desktop and in the phone app, without ffmpeg. The segments are read
// apart (`demuxSegment`): their frames' bytes go on to a file as they come, in time order, and only
// their sizes and times are kept; then the MP4's header (`mp4Header`: ftyp and moov, before the
// data, as ffmpeg's `+faststart` puts it) is written, the frames' bytes after it as its mdat.

/** A frame of a track: its bytes' length, its time (the track's timescale), and a key frame. */
export interface Sample {
  size: number;
  dts: number;
  /** Shown at dts + cts (B-frames). */
  cts: number;
  key: boolean;
}

export interface VideoTrack {
  kind: "video";
  timescale: number;
  width: number;
  height: number;
  sps: Uint8Array;
  pps: Uint8Array;
  samples: Sample[];
}

export interface AudioTrack {
  kind: "audio";
  timescale: number;
  /** AAC's AudioSpecificConfig (2 bytes). */
  config: Uint8Array;
  channels: number;
  samples: Sample[];
}

/** A frame read out of a segment: its track, its time in seconds (to order the frames by), its bytes
 *  as the MP4 holds them (H.264 with 4-byte lengths, AAC without its ADTS header). */
export interface Frame {
  kind: "video" | "audio";
  seconds: number;
  bytes: Uint8Array;
}

const PACKET = 188;
const H264 = 0x1b;
const AAC = 0x0f;
/** MPEG-1/2 video, MPEG-4 part 2, HEVC. */
const OTHER_VIDEO = [0x01, 0x02, 0x10, 0x24];
/** MPEG audio, AAC in LATM, AC-3, E-AC-3. */
const OTHER_AUDIO = [0x03, 0x04, 0x11, 0x81, 0x87];
const CLOCK = 90_000;
const AAC_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

/** What reading the segments keeps between them: the streams' ids, the tracks' tables. */
export interface Demuxer {
  video?: VideoTrack;
  audio?: AudioTrack;
  /** PIDs of the elementary streams, found in the PMT. */
  pids: { pmt?: number; video?: number; audio?: number };
  /** The last timestamp read, unwrapped (33 bits wrap round about every 26.5 hours). */
  last?: number;
  /** An ADTS frame begun at the end of an audio PES, finished by the next: its bytes, its time. */
  carry?: { bytes: Uint8Array; time: number };
}

export const newDemuxer = (
  width: number,
  height: number,
): Demuxer & { size: [number, number] } => ({
  pids: {},
  size: [width, height],
});

const WRAP = 2 ** 33;

/** A timestamp made continuous with the one before it across the 33-bit wrap. */
function unwrap(d: Demuxer, ts: number) {
  let t = ts;
  if (d.last !== undefined) {
    while (t < d.last - WRAP / 2) t += WRAP;
    while (t > d.last + WRAP / 2) t -= WRAP;
  }
  d.last = t;
  return t;
}

/** A PES's timestamp (33 bits, 90 kHz) at `at`. */
const timestamp = (b: Uint8Array, at: number) =>
  ((b[at] as number) & 0x0e) * 536870912 + // << 29
  ((b[at + 1] as number) << 22) +
  (((b[at + 2] as number) & 0xfe) << 14) +
  ((b[at + 3] as number) << 7) +
  (((b[at + 4] as number) & 0xfe) >> 1);

/** A segment's packets gathered into PES packets per stream. */
function pesOf(d: Demuxer, segment: Uint8Array) {
  const out: Array<{ pid: number; data: Uint8Array }> = [];
  const open = new Map<number, Uint8Array[]>();
  const flush = (pid: number) => {
    const parts = open.get(pid);
    if (!parts?.length) return;
    let size = 0;
    for (const p of parts) size += p.length;
    const data = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      data.set(p, at);
      at += p.length;
    }
    out.push({ pid, data });
    open.delete(pid);
  };
  for (let at = 0; at + PACKET <= segment.length; at += PACKET) {
    if (segment[at] !== 0x47) throw new Error("not an MPEG-TS segment");
    const start = ((segment[at + 1] as number) & 0x40) !== 0;
    const pid = (((segment[at + 1] as number) & 0x1f) << 8) | (segment[at + 2] as number);
    const control = ((segment[at + 3] as number) >> 4) & 3;
    let p = at + 4;
    if (control & 2) p += 1 + (segment[p] as number);
    if (!(control & 1) || p >= at + PACKET) continue;
    const payload = segment.subarray(p, at + PACKET);
    if (pid === 0 || pid === d.pids.pmt) {
      if (start) readTable(d, pid, payload.subarray(1 + (payload[0] as number)));
      continue;
    }
    if (pid !== d.pids.video && pid !== d.pids.audio) continue;
    if (start) flush(pid);
    const parts = open.get(pid) ?? [];
    parts.push(payload);
    open.set(pid, parts);
  }
  for (const pid of [...open.keys()]) flush(pid);
  return out;
}

/** The PAT (where the PMT is) or the PMT (the streams). */
function readTable(d: Demuxer, pid: number, t: Uint8Array) {
  const length = (((t[1] as number) & 0x0f) << 8) | (t[2] as number);
  const end = Math.min(t.length, 3 + length - 4);
  if (pid === 0) {
    for (let p = 8; p + 4 <= end; p += 4) {
      const program = ((t[p] as number) << 8) | (t[p + 1] as number);
      if (program) d.pids.pmt = (((t[p + 2] as number) & 0x1f) << 8) | (t[p + 3] as number);
    }
    return;
  }
  const info = (((t[10] as number) & 0x0f) << 8) | (t[11] as number);
  let otherVideo: number | undefined;
  let otherAudio: number | undefined;
  for (let p = 12 + info; p + 5 <= end; ) {
    const type = t[p] as number;
    const es = (((t[p + 1] as number) & 0x1f) << 8) | (t[p + 2] as number);
    if (type === H264 && d.pids.video === undefined) d.pids.video = es;
    if (type === AAC && d.pids.audio === undefined) d.pids.audio = es;
    if (OTHER_VIDEO.includes(type)) otherVideo = type;
    if (OTHER_AUDIO.includes(type)) otherAudio = type;
    p += 5 + ((((t[p + 3] as number) & 0x0f) << 8) | (t[p + 4] as number));
  }
  // Video or sound only in another coding would make a film without it: an error, not a silent one.
  if (d.pids.video === undefined && otherVideo !== undefined)
    throw new Error(`the stream's video is not H.264 (stream type ${otherVideo})`);
  if (d.pids.audio === undefined && otherAudio !== undefined)
    throw new Error(`the stream's sound is not AAC in ADTS (stream type ${otherAudio})`);
}

/** The NAL units of an Annex B byte stream. */
function nalUnits(b: Uint8Array) {
  const units: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i + 3 <= b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      if (start >= 0) {
        let end = i;
        while (end > start && b[end - 1] === 0) end--;
        units.push(b.subarray(start, end));
      }
      start = i + 3;
      i += 2;
    }
  }
  if (start >= 0 && start < b.length) units.push(b.subarray(start));
  return units;
}

/** One segment read: its frames, in time order; the tracks' tables grow by them. */
export function demuxSegment(
  d: Demuxer & { size: [number, number] },
  segment: Uint8Array,
): Frame[] {
  const frames: Frame[] = [];
  for (const { pid, data } of pesOf(d, segment)) {
    if (data[0] !== 0 || data[1] !== 0 || data[2] !== 1) continue;
    const flags = (data[7] as number) >> 6;
    const headerEnd = 9 + (data[8] as number);
    const pts = flags & 2 ? unwrap(d, timestamp(data, 9)) : undefined;
    const dts = flags === 3 ? unwrap(d, timestamp(data, 14)) : pts;
    let body = data.subarray(headerEnd);
    if (pid === d.pids.video) {
      // A frame without its time cannot be placed: the film would drift from its sound.
      if (pts === undefined || dts === undefined) throw new Error("a video frame without its time");
      const kept: Uint8Array[] = [];
      let key = false;
      for (const nal of nalUnits(body)) {
        const type = (nal[0] as number) & 0x1f;
        if (type === 7 || type === 8) {
          if (!d.video) {
            d.video = {
              kind: "video",
              timescale: CLOCK,
              width: d.size[0],
              height: d.size[1],
              sps: new Uint8Array(),
              pps: new Uint8Array(),
              samples: [],
            };
          }
          if (type === 7 && !d.video.sps.length) d.video.sps = nal.slice();
          if (type === 8 && !d.video.pps.length) d.video.pps = nal.slice();
          continue;
        }
        if (type === 9) continue;
        if (type === 5) key = true;
        kept.push(nal);
      }
      if (!kept.length || !d.video) continue;
      let size = 0;
      for (const n of kept) size += 4 + n.length;
      const bytes = new Uint8Array(size);
      const view = new DataView(bytes.buffer);
      let at = 0;
      for (const n of kept) {
        view.setUint32(at, n.length);
        bytes.set(n, at + 4);
        at += 4 + n.length;
      }
      d.video.samples.push({ size, dts, cts: pts - dts, key });
      frames.push({ kind: "video", seconds: dts / CLOCK, bytes });
    }
    if (pid === d.pids.audio) {
      // The frames that begin in this PES are timed from its PTS; one carried over from the PES
      // before it keeps its own time.
      const carried = d.carry;
      d.carry = undefined;
      if (carried) body = concat([carried.bytes, body]);
      if (pts === undefined && !carried) continue;
      let n = 0;
      /** The time of the frame at `p`, the `n`th here. */
      const timeOf = (p: number, rate: number) =>
        carried && p === 0
          ? carried.time
          : Math.round(((pts ?? 0) * rate) / CLOCK) + (n - (carried ? 1 : 0)) * 1024;
      for (let p = 0; p < body.length; ) {
        if (body[p] !== 0xff) break;
        if (p + 7 > body.length) {
          // A frame's header cut by the PES's end: the rest of it comes in the next.
          if (pts !== undefined || p === 0)
            d.carry = { bytes: body.slice(p), time: timeOf(p, d.audio?.timescale ?? 44100) };
          break;
        }
        if (((body[p + 1] as number) & 0xf0) !== 0xf0) break;
        const crc = ((body[p + 1] as number) & 1) === 0;
        const profile = (body[p + 2] as number) >> 6;
        const rateIndex = ((body[p + 2] as number) >> 2) & 0x0f;
        const channels = (((body[p + 2] as number) & 1) << 2) | ((body[p + 3] as number) >> 6);
        const length =
          (((body[p + 3] as number) & 3) << 11) |
          ((body[p + 4] as number) << 3) |
          ((body[p + 5] as number) >> 5);
        const head = crc ? 9 : 7;
        if (length < head) break;
        const rate = AAC_RATES[rateIndex] ?? 44100;
        if (!(carried && p === 0) && pts === undefined)
          throw new Error("a sound frame without its time");
        const time = timeOf(p, rate);
        if (p + length > body.length) {
          // The rest of this frame comes in the next PES.
          d.carry = { bytes: body.slice(p), time };
          break;
        }
        if (!d.audio) {
          const object = profile + 1;
          d.audio = {
            kind: "audio",
            timescale: rate,
            config: new Uint8Array([
              (object << 3) | (rateIndex >> 1),
              ((rateIndex & 1) << 7) | (channels << 3),
            ]),
            channels,
            samples: [],
          };
        }
        const bytes = body.slice(p + head, p + length);
        d.audio.samples.push({ size: bytes.length, dts: time, cts: 0, key: true });
        frames.push({ kind: "audio", seconds: time / rate, bytes });
        n++;
        p += length;
      }
    }
  }
  return frames.sort((a, b) => a.seconds - b.seconds);
}

function concat(parts: Uint8Array[]) {
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// MP4 boxes.
const u8 = (...v: number[]) => new Uint8Array(v);
const u16 = (v: number) => u8((v >> 8) & 0xff, v & 0xff);
const u32 = (v: number) => u8((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
const u64 = (v: number) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(v));
  return out;
};
const text = (s: string) => new TextEncoder().encode(s);
const cat = concat;
/** 32-bit numbers as one array (a table of a long film's thousands: never spread as arguments). */
function u32s(values: Iterable<number>) {
  const list = [...values];
  const out = new Uint8Array(list.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < list.length; i++) view.setUint32(i * 4, list[i] as number);
  return out;
}
function u64s(values: number[]) {
  const out = new Uint8Array(values.length * 8);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) view.setBigUint64(i * 8, BigInt(values[i] as number));
  return out;
}
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = cat(parts);
  return cat([u32(8 + body.length), text(type), body]);
};
const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]) =>
  box(type, u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...parts);
const MATRIX = cat([
  u32(0x10000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x10000),
  u32(0),
  u32(0),
  u32(0),
  u32(0x40000000),
]);

/** A track's samples' durations (the last as the one before it). */
function durations(samples: Sample[]) {
  return samples.map((s, i) => {
    const next = samples[i + 1];
    if (next) return Math.max(0, next.dts - s.dts);
    const prev = samples[i - 1];
    return prev ? Math.max(0, s.dts - prev.dts) : 0;
  });
}

/** Runs of equal values: [count, value] pairs. */
function runs(values: number[]) {
  const out: Array<[number, number]> = [];
  for (const v of values) {
    const last = out.at(-1);
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

function sampleTable(track: VideoTrack | AudioTrack, offsets: number[], big: boolean) {
  const { samples } = track;
  const entry =
    track.kind === "video"
      ? box(
          "avc1",
          u8(0, 0, 0, 0, 0, 0),
          u16(1),
          new Uint8Array(16),
          u16(track.width),
          u16(track.height),
          u32(0x480000),
          u32(0x480000),
          u32(0),
          u16(1),
          new Uint8Array(32),
          u16(0x18),
          u16(0xffff),
          box(
            "avcC",
            u8(1, track.sps[1] ?? 0, track.sps[2] ?? 0, track.sps[3] ?? 0, 0xff, 0xe1),
            u16(track.sps.length),
            track.sps,
            u8(1),
            u16(track.pps.length),
            track.pps,
          ),
        )
      : box(
          "mp4a",
          u8(0, 0, 0, 0, 0, 0),
          u16(1),
          new Uint8Array(8),
          u16(track.channels),
          u16(16),
          u32(0),
          u32(track.timescale * 0x10000),
          full(
            "esds",
            0,
            0,
            // ES descriptor: id 1; a decoder config (AAC, audio), its specific info; SL config.
            u8(0x03, 23 + track.config.length),
            u16(1),
            u8(0),
            u8(0x04, 15 + track.config.length, 0x40, 0x15),
            u8(0, 0, 0),
            u32(0),
            u32(0),
            u8(0x05, track.config.length),
            track.config,
            u8(0x06, 1, 2),
          ),
        );
  const stts = runs(durations(samples));
  const cts = samples.map((s) => s.cts);
  const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
  return box(
    "stbl",
    full("stsd", 0, 0, u32(1), entry),
    full("stts", 0, 0, u32(stts.length), u32s(stts.flat())),
    ...(cts.some((c) => c !== 0)
      ? [full("ctts", 0, 0, u32(samples.length), u32s(cts.flatMap((c) => [1, c])))]
      : []),
    ...(track.kind === "video" && keys.length < samples.length
      ? [full("stss", 0, 0, u32(keys.length), u32s(keys))]
      : []),
    full("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1)),
    full("stsz", 0, 0, u32(0), u32(samples.length), u32s(samples.map((s) => s.size))),
    big
      ? full("co64", 0, 0, u32(offsets.length), u64s(offsets))
      : full("stco", 0, 0, u32(offsets.length), u32s(offsets)),
  );
}

/** The track's duration in its timescale. */
const trackDuration = (t: VideoTrack | AudioTrack) =>
  durations(t.samples).reduce((a, b) => a + b, 0);

function trak(
  track: VideoTrack | AudioTrack,
  id: number,
  offsets: number[],
  big: boolean,
  delay: number,
) {
  const duration = trackDuration(track);
  const movieDuration = Math.round((duration * 1000) / track.timescale) + delay;
  const video = track.kind === "video";
  return box(
    "trak",
    full(
      "tkhd",
      0,
      3,
      u32(0),
      u32(0),
      u32(id),
      u32(0),
      u32(movieDuration),
      new Uint8Array(8),
      u16(0),
      u16(video ? 0 : 1),
      u16(video ? 0 : 0x100),
      u16(0),
      MATRIX,
      u32(video ? track.width * 0x10000 : 0),
      u32(video ? track.height * 0x10000 : 0),
    ),
    // A track that starts later waits as long (an empty edit), then plays from its start.
    ...(delay
      ? [
          box(
            "edts",
            full(
              "elst",
              0,
              0,
              u32(2),
              u32(delay),
              u32(0xffffffff),
              u32(0x10000),
              u32(movieDuration - delay),
              u32(0),
              u32(0x10000),
            ),
          ),
        ]
      : []),
    box(
      "mdia",
      full("mdhd", 0, 0, u32(0), u32(0), u32(track.timescale), u32(duration), u16(0x55c4), u16(0)),
      full(
        "hdlr",
        0,
        0,
        u32(0),
        text(video ? "vide" : "soun"),
        new Uint8Array(12),
        text(video ? "VideoHandler\0" : "SoundHandler\0"),
      ),
      box(
        "minf",
        video ? full("vmhd", 0, 1, new Uint8Array(8)) : full("smhd", 0, 0, u32(0)),
        box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
        sampleTable(track, offsets, big),
      ),
    ),
  );
}

/**
 * The MP4's head — ftyp, moov, and the mdat's own header — for the tracks' frames written after it
 * in `order` (each frame's track, as they were written): their places in the file follow from it.
 */
export function mp4Header(
  tracks: { video?: VideoTrack; audio?: AudioTrack },
  order: Array<"video" | "audio">,
  dataBytes: number,
) {
  const list = [tracks.video, tracks.audio].filter((t): t is VideoTrack | AudioTrack => !!t);
  const ftyp = box("ftyp", text("isom"), u32(512), text("isomiso2avc1mp41"));
  // Each track's start in the movie (ms): the later one waits for the other.
  const starts = list.map((t) => ((t.samples[0]?.dts ?? 0) * 1000) / t.timescale);
  const first = Math.min(...starts);
  const delays = starts.map((s) => Math.round(s - first));
  const build = (dataAt: number, big: boolean) => {
    const offsets = list.map(() => [] as number[]);
    const next = list.map(() => 0);
    let at = dataAt;
    for (const kind of order) {
      const i = list.findIndex((t) => t.kind === kind);
      const track = list[i] as VideoTrack | AudioTrack;
      (offsets[i] as number[]).push(at);
      at += (track.samples[next[i] as number] as Sample).size;
      next[i] = (next[i] as number) + 1;
    }
    const duration = Math.max(
      ...list.map((t, i) => Math.round((trackDuration(t) * 1000) / t.timescale) + (delays[i] ?? 0)),
    );
    return box(
      "moov",
      full(
        "mvhd",
        0,
        0,
        u32(0),
        u32(0),
        u32(1000),
        u32(duration),
        u32(0x10000),
        u16(0x100),
        new Uint8Array(10),
        MATRIX,
        new Uint8Array(24),
        u32(list.length + 1),
      ),
      ...list.map((t, i) => trak(t, i + 1, offsets[i] as number[], big, delays[i] ?? 0)),
    );
  };
  const big = dataBytes + 100 * 1024 * 1024 >= 0xffffffff;
  const mdatHead = big ? 16 : 8;
  // The moov's size does not depend on the offsets' values: built once to measure, once placed.
  const measured = build(0, big).length;
  const moov = build(ftyp.length + measured + mdatHead, big);
  const mdat = big
    ? cat([u32(1), text("mdat"), u64(16 + dataBytes)])
    : cat([u32(8 + dataBytes), text("mdat")]);
  return cat([ftyp, moov, mdat]);
}
