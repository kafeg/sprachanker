// Recording oneself (08): whether this page may use the microphone (a secure context with
// MediaRecorder: HTTPS or this computer), the microphone chosen on this device, and a recorder — start,
// stop with the take as the browser encoded it (Safari MP4/AAC, Chrome WebM/Opus), its loudness while
// it records. Nothing here talks to the server.
import { useCallback, useEffect, useRef, useState } from "react";

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

/** One recording: the audio as encoded, its type, its length. */
export interface Take {
  blob: Blob;
  type: string;
  ms: number;
}

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
    setState("starting");
    try {
      const device = micDevice.get();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: device ? { deviceId: { ideal: device } } : true,
      });
      const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
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
      // Loudness as the root mean square of the waveform, for the level shown while recording.
      const measure = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
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
        };
        release();
        setState("idle");
        if (take.blob.size) handOver.current(take);
      };
      recorder.start();
      setState("recording");
    } catch (error) {
      release();
      setState(
        error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "failed",
      );
    }
  }, [maxMs, release, stop]);

  useEffect(() => release, [release]);
  return { state, level, start, stop };
}
