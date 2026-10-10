import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import { ReadAloud } from "../../src/audio/read-aloud-settings.tsx";
import { useReadLanguages } from "../../src/audio/read-languages.ts";
import { samplesOf } from "../../src/audio/samples.ts";
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
  // One part at a time: the next when the device has said the last.
  await waitFor(() => expect(said).toHaveLength(1));
  await finish();
  await waitFor(() => expect(said).toHaveLength(2));
  await finish();
  await waitFor(() => expect(said).toHaveLength(3));
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

/** Courses installed here, by the editions they are in. */
const installed = (...editions: string[][]): [unknown[], unknown] => [
  ["courses"],
  editions.map((e) => ({ editions: e })),
];

test("the languages read aloud: those the courses here teach, else those the shown catalogue does; and the interface's", () => {
  const langs = (data: Array<[unknown[], unknown]>) => {
    const client = queryClient([[["courses"], []], ...data]);
    return renderHook(() => useReadLanguages(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }).result.current;
  };
  const catalog: [unknown[], unknown] = [
    ["catalog"],
    [
      { series: "dw.nicos-weg", edition: "ru-de" },
      { series: "lid", edition: "de-de", kind: "exam" },
      { series: "coerll.dib", edition: "en-fr", experimental: true },
    ],
  ];
  expect(langs([installed(["ru-de", "en-de"], ["en-ru"]), catalog])).toEqual(["de", "ru", "en"]);
  expect(langs([catalog])).toEqual(["de", "en"]);
});

test("Settings: each language read aloud with its voice (automatic: the best one) and Listen", async () => {
  const view = await renderApp(<ReadAloud />, {
    data: [
      installed(["en-de"], ["en-ru"]),
      [["catalog"], []],
      [["piper-voices"], { engine: false, voices: [] }],
      [["qwen-tts"], NO_QWEN],
    ],
  });
  expect(view.getByText("This device's voices")).toBeTruthy();
  expect(view.getByText(/^Speed:/)).toBeTruthy();
  // Piper not built here: its card says so and cannot be chosen.
  expect(view.getByRole("button", { name: /Piper on this computer/ })).toHaveProperty(
    "disabled",
    true,
  );
  expect(view.getByText("Automatic — Petra (Enhanced)")).toBeTruthy();
  expect(view.getByText("Automatic — Milena")).toBeTruthy();
  // Listen reads the phrase under it, in the voice's language.
  const field = view.getByRole("textbox", { name: "Text to listen to in German" });
  const phrase = (field as HTMLTextAreaElement).value;
  expect(phrase).toBe(samplesOf("de")[0] as string);
  const listen = () =>
    fireEvent.click(view.getAllByRole("button", { name: "Listen" })[0] as HTMLElement);
  listen();
  expect(said).toEqual([{ text: phrase, lang: "de-DE", voice: "petra", rate: 1 }]);
  // Another phrase, then the learner's own text; left empty, the phrase again.
  fireEvent.click(view.getAllByRole("button", { name: "Another phrase" })[0] as HTMLElement);
  expect((field as HTMLTextAreaElement).value).toBe(samplesOf("de")[1] as string);
  fireEvent.change(field, { target: { value: "Wie spät ist es?" } });
  listen();
  expect(said.at(-1)?.text).toBe("Wie spät ist es?");
  fireEvent.change(field, { target: { value: "  " } });
  listen();
  expect(said.at(-1)?.text).toBe(samplesOf("de")[1] as string);
});

const NO_QWEN = { engine: false, models: [], languages: [], speakers: [], defaultSpeaker: "ryan" };

const PIPER = {
  engine: true,
  voices: [
    {
      id: "de_DE-thorsten-medium",
      lang: "de",
      region: "DE",
      name: "thorsten",
      quality: "medium",
      bytes: 67e6,
      installed: true,
    },
    {
      id: "de_DE-thorsten-high",
      lang: "de",
      region: "DE",
      name: "thorsten",
      quality: "high",
      bytes: 116e6,
      installed: false,
    },
    {
      id: "de_AT-hmm-low",
      lang: "de",
      region: "AT",
      name: "hmm",
      quality: "low",
      bytes: 60e6,
      installed: false,
      downloaded: 30e6,
    },
    {
      id: "ru_RU-irina-medium",
      lang: "ru",
      region: "RU",
      name: "irina",
      quality: "medium",
      bytes: 67e6,
      installed: false,
    },
  ],
};

test("Settings with Piper: each language's voices — the one reading, those to download, one coming", async () => {
  const view = await renderApp(<ReadAloud />, {
    data: [
      [["settings"], { "speech.readEngine": "piper" }],
      installed(["en-de"], ["en-ru"]),
      [["catalog"], []],
      [["piper-voices"], PIPER],
      [["qwen-tts"], NO_QWEN],
    ],
  });
  expect(view.getByText("1 voice downloaded")).toBeTruthy();
  expect(view.getByText("Automatic — thorsten · Germany · medium quality")).toBeTruthy();
  // Germany first, best quality first; a download in progress shows how far it is.
  const rows = view.getAllByRole("listitem").map((li) => li.textContent);
  expect(rows[0]).toContain("thorsten · Germany · high quality");
  expect(rows.some((r) => r?.includes("50 %") || r?.includes("50%"))).toBe(true);
  expect(view.getByText(/No voice for Russian yet/)).toBeTruthy();
  expect(view.getAllByRole("button", { name: "Download" }).length).toBeGreaterThan(0);
});

test("reading with Piper: a language with a voice is said by the server, one without by the device", async () => {
  const asked: Array<{ text: string; lang: string }> = [];
  const played: string[] = [];
  const realFetch = globalThis.fetch;
  const realAudio = globalThis.Audio;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push((await request.json()) as { text: string; lang: string });
    return new Response(new Blob([new Uint8Array([1])], { type: "audio/wav" }));
  }) as typeof fetch;
  (globalThis as { Audio: unknown }).Audio = class {
    onended?: () => void;
    constructor(readonly src: string) {}
    async play() {
      played.push(this.src);
      setTimeout(() => this.onended?.(), 0);
    }
    pause() {}
  };
  try {
    const view = await renderApp(
      <SpeakButton parts={replyParts("Скажи: Ich heiße Anna.", "ru", "de")} label="reply" />,
      {
        data: [
          [["settings"], { "speech.readEngine": "piper" }],
          [["piper-voices"], PIPER],
        ],
      },
    );
    fireEvent.click(view.getByRole("button", { name: "Read aloud: reply" }));
    // Russian has no Piper voice here: the device says it first.
    await waitFor(() => expect(said.map((s) => s.text)).toEqual(["Скажи:"]));
    await finish();
    await waitFor(() => expect(played).toHaveLength(1));
    expect(asked).toEqual([{ text: "Ich heiße Anna.", lang: "de" }]);
  } finally {
    globalThis.fetch = realFetch;
    (globalThis as { Audio: unknown }).Audio = realAudio;
  }
});

test("the same text stopped and read again: only the new reading goes on", async () => {
  const parts = [
    { text: "Eins.", lang: "de" },
    { text: "Zwei.", lang: "de" },
    { text: "Drei.", lang: "de" },
  ];
  const view = await renderApp(<SpeakButton parts={parts} label="Zahlen" />);
  fireEvent.click(view.getByRole("button", { name: "Read aloud: Zahlen" }));
  await waitFor(() => expect(said).toHaveLength(1));
  fireEvent.click(view.getByRole("button", { name: "Stop reading" }));
  fireEvent.click(view.getByRole("button", { name: "Read aloud: Zahlen" }));
  await waitFor(() => expect(said).toHaveLength(2));
  // Give the stopped run every chance to go on: it must not.
  await act(() => new Promise((r) => setTimeout(r, 20)));
  expect(said.map((s) => s.text)).toEqual(["Eins.", "Eins."]);
  await finish();
  await waitFor(() => expect(said.map((s) => s.text)).toEqual(["Eins.", "Eins.", "Zwei."]));
});

test("a piece the server cannot say is said by the device's voice", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ error: "speech_unavailable" }, { status: 409 })) as unknown as typeof fetch;
  try {
    const view = await renderApp(
      <SpeakButton parts={[{ text: "Hallo!", lang: "de" }]} label="x" />,
      {
        data: [
          [["settings"], { "speech.readEngine": "piper" }],
          [["piper-voices"], PIPER],
        ],
      },
    );
    fireEvent.click(view.getByRole("button", { name: "Read aloud: x" }));
    await waitFor(() => expect(said.map((s) => s.text)).toEqual(["Hallo!"]));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Settings with Qwen3-TTS: its models (the one in use), each language's speaker; a language it lacks said so", async () => {
  const view = await renderApp(<ReadAloud />, {
    data: [
      [["settings"], { "speech.readEngine": "qwen" }],
      installed(["en-de"], ["en-ar"]),
      [["catalog"], []],
      [["piper-voices"], { engine: false, voices: [] }],
      [
        ["qwen-tts"],
        {
          engine: true,
          models: [
            { id: "0.6b", bytes: 968e6, installed: true, inUse: false },
            { id: "1.7b", bytes: 2043e6, installed: true, inUse: true },
          ],
          languages: ["de", "en", "ru"],
          speakers: ["ryan", "serena"],
          defaultSpeaker: "ryan",
        },
      ],
    ],
  });
  expect(view.getByText("Ready: a model downloaded")).toBeTruthy();
  // Both there: the one in use is marked, the other can be used instead.
  const row = (name: RegExp) => view.getByText(name).closest("li") as HTMLElement;
  expect(row(/Large model/).textContent).toContain("In use");
  expect(row(/Small model/).textContent).not.toContain("In use");
  expect(within(row(/Small model/)).getByRole("button", { name: "Use" })).toBeTruthy();
  // One voice for every language: no voice per language.
  expect(view.getByRole("combobox", { name: "Voice" }).textContent).toBe("Automatic — Ryan");
  expect(view.queryByRole("combobox", { name: "Voice for German" })).toBeNull();
  expect(view.getByText(/Qwen3-TTS does not speak Arabic/)).toBeTruthy();
  // It has no speed of its own: no speed slider with it.
  expect(view.queryByText(/^Speed:/)).toBeNull();
});
