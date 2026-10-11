import { afterEach, expect, test } from "bun:test";
import type { ItemOf } from "@sprachanker/schema";
import { act, fireEvent } from "@testing-library/react";
import { type SpeechHost, SpeechProvider } from "../../src/audio/context.ts";
import { Respond } from "../../src/exercises/respond.tsx";
import { ChatComposer } from "../../src/llm/parts.tsx";
import { claimPlayback } from "../../src/ui/playback.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
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
    <ChatComposer value="" onChange={() => {}} onSend={() => {}} placeholder="…" speak="de" />
  </SpeechProvider>
);

test("a microphone in the language learnt beside the message box while recognition is on", async () => {
  microphoneHere();
  const view = await renderApp(composer(true));
  expect(
    view.getAllByRole("button", { name: /^Say it in/ }).map((b) => b.getAttribute("aria-label")),
  ).toEqual(["Say it in German"]);
});

test("a free answer: a microphone only where it is to be said, never where it is written", async () => {
  microphoneHere();
  const item = (input: "text" | "speech") =>
    ({ key: "s/c/00-01/x-01#1", input, reference: [] }) as unknown as ItemOf<"respond">;
  for (const input of ["speech", "text"] as const) {
    const view = await renderApp(
      <SpeechProvider value={host(true)}>
        <TargetLang value="de">
          <Respond item={item(input)} answer={undefined} onAnswer={() => {}} url={(p) => p} />
        </TargetLang>
      </SpeechProvider>,
    );
    expect(view.queryAllByRole("button", { name: "Say it in German" })).toHaveLength(
      input === "speech" ? 1 : 0,
    );
    view.unmount();
  }
});

test("no microphone while recognition is off", async () => {
  microphoneHere();
  const view = await renderApp(composer(false));
  expect(view.queryByRole("button", { name: /^Say it in/ })).toBeNull();
});

test("saying a line stops what is read aloud (an exam conversation's examiner): the microphone never hears it", async () => {
  microphoneHere();
  let paused = 0;
  const view = await renderApp(composer(true));
  claimPlayback({ pause: () => paused++ });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Say it in German" }));
  });
  expect(paused).toBe(1);
});
