import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { ReadAloud } from "../../src/audio/read-aloud-settings.tsx";
import { SpeakButton } from "../../src/audio/speak-button.tsx";
import { useReadAtOnce } from "../../src/audio/speaker.ts";
import { ChatBubble, replyParts } from "../../src/llm/parts.tsx";
import { queryClient, renderApp } from "../render.tsx";

/** The device's voices as a browser gives them, and what it was asked to say. */
const VOICES = [
  { voiceURI: "anna", name: "Anna", lang: "de-DE", localService: true, default: false },
  {
    voiceURI: "petra",
    name: "Petra (Enhanced)",
    lang: "de-DE",
    localService: true,
    default: false,
  },
  { voiceURI: "milena", name: "Milena", lang: "ru-RU", localService: true, default: true },
];
let said: Array<{ text: string; lang: string; voice?: string; rate: number }> = [];
let pending: Array<{ onend?: () => void }> = [];
let cancelled = 0;

class Utterance {
  lang = "";
  voice?: { voiceURI: string };
  rate = 1;
  onend?: () => void;
  onerror?: () => void;
  constructor(readonly text: string) {}
}

beforeEach(() => {
  said = [];
  pending = [];
  cancelled = 0;
  const g = globalThis as Record<string, unknown>;
  g.SpeechSynthesisUtterance = Utterance;
  g.speechSynthesis = {
    getVoices: () => VOICES,
    addEventListener() {},
    removeEventListener() {},
    speak(u: Utterance) {
      said.push({ text: u.text, lang: u.lang, voice: u.voice?.voiceURI, rate: u.rate });
      pending.push(u);
    },
    cancel() {
      cancelled++;
      pending = [];
    },
  };
});
afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.speechSynthesis;
  delete g.SpeechSynthesisUtterance;
});
/** The device finishes reading what it was given. */
const finish = () => act(() => pending.at(-1)?.onend?.());

test("a tutor's reply read part by part, each language in its best voice; a second tap stops it", async () => {
  const parts = replyParts("Скажи: **Ich heiße Anna.** Это значит «меня зовут Анна».", "ru", "de");
  const view = await renderApp(
    <ChatBubble from="other" say={parts}>
      …
    </ChatBubble>,
    { data: [[["settings"], { "speech.readRate": 0.8 }]] },
  );
  const button = view.getByRole("button", { name: /Read aloud/ });
  fireEvent.click(button);
  expect(said).toEqual([
    { text: "Скажи:", lang: "ru-RU", voice: "milena", rate: 0.8 },
    { text: "Ich heiße Anna.", lang: "de-DE", voice: "petra", rate: 0.8 },
    { text: "Это значит «меня зовут Анна».", lang: "ru-RU", voice: "milena", rate: 0.8 },
  ]);
  const stop = view.getByRole("button", { name: "Stop reading" });
  expect(stop.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(stop);
  expect(cancelled).toBe(1);
  expect(view.getByRole("button", { name: /Read aloud/ })).toBeTruthy();
});

test("the voice the profile chose is used while the device has it; reading ends by itself", async () => {
  const view = await renderApp(
    <SpeakButton parts={[{ text: "Hallo", lang: "de" }]} label="Hallo" />,
    {
      data: [[["settings"], { "speech.voices": { device: { de: "anna" } } }]],
    },
  );
  fireEvent.click(view.getByRole("button", { name: "Read aloud: Hallo" }));
  expect(said[0]?.voice).toBe("anna");
  finish();
  await waitFor(() => expect(view.getByRole("button", { name: "Read aloud: Hallo" })).toBeTruthy());
});

test("no button where the device has no voice for the language", async () => {
  const view = await renderApp(<SpeakButton parts={[{ text: "Bonjour", lang: "fr" }]} />);
  expect(view.queryByRole("button")).toBeNull();
});

test("read at once: only a line that comes while the page is open, and only what the profile asks for", () => {
  const run = (mode: string, kind: "scene" | "tutor") => {
    const client = queryClient([[["settings"], { "speech.readAtOnce": mode }]]);
    const hook = renderHook(
      ({ loaded, key }: { loaded: boolean; key?: string }) =>
        useReadAtOnce(kind, loaded, key, key ? [{ text: `Zeile ${key}`, lang: "de" }] : []),
      {
        initialProps: { loaded: false } as { loaded: boolean; key?: string },
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    hook.rerender({ loaded: true, key: "1" });
    hook.rerender({ loaded: true, key: "2" });
    hook.unmount();
    return said.splice(0).map((s) => s.text);
  };
  expect(run("scenes", "scene")).toEqual(["Zeile 2"]);
  expect(run("scenes", "tutor")).toEqual([]);
  expect(run("all", "tutor")).toEqual(["Zeile 2"]);
  expect(run("none", "scene")).toEqual([]);
});

test("Settings: the profile's languages with their voice (automatic: the best one) and Listen", async () => {
  const view = await renderApp(<ReadAloud />, {
    data: [[["settings"], { "learner.target": "de", "learner.native": "ru" }]],
  });
  expect(view.getByText("This device's voices")).toBeTruthy();
  expect(view.getByText("Automatic — Petra (Enhanced)")).toBeTruthy();
  expect(view.getByText("Automatic — Milena")).toBeTruthy();
  fireEvent.click(view.getAllByRole("button", { name: "Listen" })[0] as HTMLElement);
  expect(said).toEqual([{ text: "Deutsch (Deutschland)", lang: "de-DE", voice: "petra", rate: 1 }]);
});
