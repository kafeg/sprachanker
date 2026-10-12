// Recording oneself: whether this page may use the microphone (a secure context with
// MediaRecorder: HTTPS or this computer), the microphone chosen on this device, and a recorder — start,
// stop with the take as the browser encoded it (Safari MP4/AAC, Chrome WebM/Opus), its loudness while
// it records and the loudest it got (a take never louder than a quiet room heard nothing). Nothing
// here talks to the server.
import { useCallback, useEffect, useRef, useState } from "react";
import { stopPlayback } from "@/ui/playback.tsx";

export type MicState = "ready" | "insecure" | "unsupported";

/** The microphone can be used here: not on plain HTTP (no secure context), not without MediaRecorder. */
export function micState(): MicState {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
    return "unsupported";
  return "ready";
}

const MIC_DEVICE = "sprachanker.micDevice";

/** The microphone chosen on this device (a device id), if any: a setting of the device, not the
 *  profile. */
export const micDevice = {
  get(): string | undefined {
    try {
      return localStorage.getItem(MIC_DEVICE) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(id: string | undefined) {
    try {
      if (id) localStorage.setItem(MIC_DEVICE, id);
      else localStorage.removeItem(MIC_DEVICE);
    } catch {
      // Storage blocked: the default microphone is used.
    }
  },
};

/** One recording: the audio as encoded, its type, its length, and its loudest moment (the root mean
 *  square of the loudest stretch measured, 0–1; none or 0 when nothing was measured: a hidden page,
 *  a suspended audio context). */
export interface Take {
  blob: Blob;
  type: string;
  ms: number;
  peak?: number;
}

/** Speech is louder than this (-50 dBFS) somewhere in a take, even a word said quietly; a quiet room
 *  is not (the server's gate too). */
const SPEECH_RMS = 0.00316;

/** Nothing in the take was loud enough to be speech: it is not kept nor sent to be heard. A
 *  loudest moment of exactly 0 is nothing measured (an audio context the browser kept suspended):
 *  the server decides. */
export const heardNothing = (take: Take) => !!take.peak && take.peak < SPEECH_RMS;

/** The browser's processing of the microphone off: noise suppression and automatic gain change the
 *  voice the recogniser hears, and nothing plays while a take records. */
const RAW = { autoGainControl: false, noiseSuppression: false, echoCancellation: false };

export type RecorderState = "idle" | "starting" | "recording" | "denied" | "failed";

/** A recording under way. */
interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  context: AudioContext;
  chunks: Blob[];
  started: number;
  frame: number;
  timer: ReturnType<typeof setTimeout>;
  peak?: number;
}

/** The types to record in, the first one the browser has. */
const TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];

/**
 * A recorder: every take — stopped by the learner or by itself after `maxMs` — goes to `onTake`. It
 * lets the microphone go when stopped or unmounted.
 */
export function useRecorder({
  maxMs = 30_000,
  onTake,
}: {
  maxMs?: number;
  onTake(take: Take): void;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const handOver = useRef(onTake);
  handOver.current = onTake;
  const session = useRef<Session | null>(null);

  const release = useCallback(() => {
    const s = session.current;
    if (!s) return;
    cancelAnimationFrame(s.frame);
    clearTimeout(s.timer);
    for (const track of s.stream.getTracks()) track.stop();
    void s.context.close();
    session.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    const s = session.current;
    if (s && s.recorder.state !== "inactive") s.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    // Nothing plays into the take: a line read aloud, a recording, a video.
    stopPlayback();
    setState("starting");
    // Made and resumed here, in the tap itself, before anything is awaited: iOS Safari runs an audio
    // context only when it starts inside the user's gesture — the meter and the take's loudness need
    // it running from the start (one still suspended leaves the loudest moment 0: the server judges).
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      void context.resume?.().catch(() => {});
      const device = micDevice.get();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: device ? { ...RAW, deviceId: { ideal: device } } : RAW,
      });
      const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const s: Session = {
        recorder,
        stream,
        context,
        chunks: [],
        started: Date.now(),
        frame: 0,
        timer: setTimeout(stop, maxMs),
      };
      session.current = s;
      // Loudness as the root mean square of the waveform, for the level shown while recording and
      // the take's loudest moment.
      const measure = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        const rms = Math.sqrt(sum / samples.length);
        s.peak = Math.max(s.peak ?? 0, rms);
        setLevel(Math.min(1, rms * 4));
        s.frame = requestAnimationFrame(measure);
      };
      measure();
      recorder.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
      recorder.onstop = () => {
        const mime = recorder.mimeType || type || "audio/webm";
        const take = {
          blob: new Blob(s.chunks, { type: mime }),
          type: mime,
          ms: Date.now() - s.started,
          ...(s.peak !== undefined && { peak: s.peak }),
        };
        release();
        setState("idle");
        if (take.blob.size) handOver.current(take);
      };
      recorder.start();
      setState("recording");
    } catch (error) {
      if (session.current) release();
      else void context?.close().catch(() => {});
      setState(
        error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "failed",
      );
    }
  }, [maxMs, release, stop]);

  useEffect(() => release, [release]);
  return { state, level, start, stop };
}
