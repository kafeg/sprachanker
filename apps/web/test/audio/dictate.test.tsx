import { afterEach, expect, test } from "bun:test";
import { type SpeechHost, SpeechProvider } from "../../src/audio/context.ts";
import { ChatComposer } from "../../src/llm/parts.tsx";
import { renderApp } from "../render.tsx";

const saved = {
  secure: Object.getOwnPropertyDescriptor(window, "isSecureContext"),
  recorder: (globalThis as { MediaRecorder?: unknown }).MediaRecorder,
};
afterEach(() => {
  if (saved.secure) Object.defineProperty(window, "isSecureContext", saved.secure);
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = saved.recorder;
});
/** A page where the microphone can be used. */
function microphoneHere() {
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {};
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: async () => ({}) },
    configurable: true,
  });
}
const host = (recognition: boolean): SpeechHost => ({
  save: async () => "01K00000000000000000000000",
  src: (id) => id,
  recognition,
  transcribe: async () => "Hallo",
  warm() {},
});
const composer = (recognition: boolean) => (
  <SpeechProvider value={host(recognition)}>
    <ChatComposer
      value=""
      onChange={() => {}}
      onSend={() => {}}
      placeholder="…"
      speak={["de", "ru", "de"]}
    />
  </SpeechProvider>
);

test("a microphone per language beside the message box while recognition is on", async () => {
  microphoneHere();
  const view = await renderApp(composer(true));
  expect(view.getByRole("button", { name: "Say it in German" }).textContent).toContain("DE");
  expect(view.getByRole("button", { name: "Say it in Russian" })).toBeTruthy();
  expect(view.getAllByRole("button", { name: /^Say it in/ })).toHaveLength(2);
});

test("no microphone while recognition is off", async () => {
  microphoneHere();
  const view = await renderApp(composer(false));
  expect(view.queryByRole("button", { name: /^Say it in/ })).toBeNull();
});
