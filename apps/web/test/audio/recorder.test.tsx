// The recorder's audio context: made and resumed in the tap itself, before the microphone is asked
// for (iOS Safari runs it only inside the gesture), and let go when the microphone is refused.
import { afterEach, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useRecorder } from "../../src/audio/recorder.ts";

const g = globalThis as Record<string, unknown>;
const saved = { recorder: g.MediaRecorder, context: g.AudioContext };
afterEach(() => {
  g.MediaRecorder = saved.recorder;
  g.AudioContext = saved.context;
});

/** What happened, in order: the context made, resumed, closed; the microphone asked for. */
function machine(refuse: boolean) {
  const order: string[] = [];
  g.AudioContext = class {
    constructor() {
      order.push("context");
    }
    resume = async () => void order.push("resume");
    close = async () => void order.push("close");
    createAnalyser = () => ({
      fftSize: 512,
      getFloatTimeDomainData: (a: Float32Array) => a.fill(0.1),
    });
    createMediaStreamSource = () => ({ connect() {} });
  };
  g.MediaRecorder = class {
    static isTypeSupported = () => true;
    state = "inactive";
    mimeType = "audio/webm";
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
    }
  };
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: async () => {
        order.push("microphone");
        if (refuse) throw new DOMException("no", "NotAllowedError");
        return { getTracks: () => [] };
      },
    },
    configurable: true,
  });
  return order;
}

test("the audio context is made and resumed before the microphone is asked for", async () => {
  const order = machine(false);
  const { result, unmount } = renderHook(() => useRecorder({ onTake() {} }));
  await act(() => result.current.start());
  expect(order.slice(0, 3)).toEqual(["context", "resume", "microphone"]);
  expect(result.current.state).toBe("recording");
  expect(result.current.level).toBeGreaterThan(0);
  unmount();
});

test("the microphone refused: the audio context is let go", async () => {
  const order = machine(true);
  const { result, unmount } = renderHook(() => useRecorder({ onTake() {} }));
  await act(() => result.current.start());
  expect(order).toEqual(["context", "resume", "microphone", "close"]);
  expect(result.current.state).toBe("denied");
  unmount();
});
