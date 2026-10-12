import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import { useListening } from "../../src/audio/listening.ts";
import { ReadAloud } from "../../src/audio/read-aloud-settings.tsx";
import { ReadByLabel } from "../../src/audio/read-by.tsx";
import { useReadLanguages } from "../../src/audio/read-languages.ts";
import { samplesOf } from "../../src/audio/samples.ts";
import type { SpokenPart } from "../../src/audio/speak.ts";
import { SpeakButton } from "../../src/audio/speak-button.tsx";
import { stop } from "../../src/audio/speaker.ts";
import { ChatBubble } from "../../src/llm/parts.tsx";
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

test("a line read in its one language with its voice; a second tap stops it", async () => {
  const view = await renderApp(
    <ChatBubble from="other" say={[{ text: "Ich heiße Anna.", lang: "de" }]}>
      …
    </ChatBubble>,
    { data: [[["settings"], { "speech.readRate": 0.8 }]] },
  );
  fireEvent.click(view.getByRole("button", { name: /Read aloud/ }));
  await waitFor(() => expect(said).toHaveLength(1));
  expect(said).toEqual([{ text: "Ich heiße Anna.", lang: "de-DE", voice: "petra", rate: 0.8 }]);
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

/** Courses and exams installed here, by their editions (the catalogue's rows). */
const installed = (...editions: string[]): [unknown[], unknown] => [
  ["catalog"],
  editions.map((edition) => ({ series: "dw.nicos-weg", edition, installed: true })),
];

test("the languages read aloud: those the courses and exams here teach, else those the shown catalogue does; and the interface's", () => {
  const langs = (data: Array<[unknown[], unknown]>) => {
    const client = queryClient(data);
    return renderHook(() => useReadLanguages(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }).result.current;
  };
  const offers = [
    { series: "dw.nicos-weg", edition: "ru-de" },
    { series: "lid", edition: "de-de", kind: "exam" },
    { series: "coerll.dib", edition: "en-fr", experimental: true },
  ];
  const here = [
    { series: "dw.nicos-weg", edition: "en-ru", installed: true },
    { series: "lid", edition: "de-pl", kind: "exam", installed: true },
  ];
  expect(langs([[["catalog"], [...offers, ...here]]])).toEqual(["ru", "pl", "en"]);
  expect(langs([[["catalog"], offers]])).toEqual(["de", "en"]);
});

test("Settings: each language read aloud with its voice (automatic: the best one) and Listen", async () => {
  const view = await renderApp(<ReadAloud />, {
    data: [
      installed("en-de", "en-ru"),
      [["piper-voices"], { engine: false, voices: [], auto: {} }],
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

/** Piper's state as the server gives it: each language's best voice first, and the one it reads
 *  with unless the profile picks one. */
const PIPER = {
  engine: true,
  auto: { de: "de_DE-thorsten-medium" },
  voices: [
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
      id: "de_DE-thorsten-medium",
      lang: "de",
      region: "DE",
      name: "thorsten",
      quality: "medium",
      bytes: 67e6,
      installed: true,
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
      installed("en-de", "en-ru"),
      [["piper-voices"], PIPER],
      [["qwen-tts"], NO_QWEN],
    ],
  });
  expect(view.getByText("1 voice downloaded")).toBeTruthy();
  expect(view.getByText("Automatic — thorsten · Germany · medium quality")).toBeTruthy();
  // In the server's order; a download in progress shows how far it is.
  const rows = view.getAllByRole("listitem").map((li) => li.textContent);
  expect(rows[0]).toContain("thorsten · Germany · high quality");
  expect(rows.some((r) => r?.includes("50 %") || r?.includes("50%"))).toBe(true);
  expect(view.getByText(/No voice for Russian yet/)).toBeTruthy();
  expect(view.getAllByRole("button", { name: "Download" }).length).toBeGreaterThan(0);

  // "Listen" while the server's voice takes its time (a model loading): said, not just a pressed
  // button.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
  try {
    fireEvent.click(view.getByRole("button", { name: "Listen" }));
    expect(view.queryByText(/^Starting the voice/)).toBeNull();
    await waitFor(() => expect(view.getByText(/^Starting the voice/)).toBeTruthy(), {
      timeout: 2000,
    });
  } finally {
    act(() => stop());
    globalThis.fetch = realFetch;
  }
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
      <SpeakButton
        parts={[
          { text: "Скажи:", lang: "ru" },
          { text: "Ich heiße Anna.", lang: "de" },
        ]}
        label="reply"
      />,
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
      installed("en-de", "en-ar"),
      [["piper-voices"], { engine: false, voices: [], auto: {} }],
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
  // Each language its own speaker (automatic: the default one).
  expect(view.getByRole("combobox", { name: "Voice for German" }).textContent).toBe(
    "Automatic — Ryan",
  );
  expect(view.getByText(/Qwen3-TTS does not speak Arabic/)).toBeTruthy();
  // It has no speed of its own: no speed slider with it.
  expect(view.queryByText(/^Speed:/)).toBeNull();
});

/** A text to listen to, as Understanding plays it. */
function Listener({ parts }: { parts: SpokenPart[] }) {
  const l = useListening(parts);
  return (
    <div>
      <button type="button" onClick={l.play}>
        play
      </button>
      <button type="button" onClick={l.pause}>
        pause
      </button>
      <button type="button" onClick={l.replay}>
        replay
      </button>
      <span>{`at ${l.at} · heard ${l.plays} · ${l.playing ? "playing" : "still"}`}</span>
    </div>
  );
}

const DIALOGUE: SpokenPart[] = [
  { text: "Guten Morgen!", lang: "de" },
  { text: "Hallo!", lang: "de", alt: true },
  { text: "Zwei Brötchen, bitte.", lang: "de" },
];

test("a text listened to line by line, the second speaker by the language's other voice: paused, played on from its line, heard to the end, from the start again", async () => {
  const view = await renderApp(<Listener parts={DIALOGUE} />);
  fireEvent.click(view.getByRole("button", { name: "play" }));
  await waitFor(() => expect(said).toHaveLength(1));
  await finish();
  await waitFor(() => expect(said).toHaveLength(2));
  // The best voice reads the first speaker, the other one the second.
  expect(said.map((s) => [s.text, s.voice])).toEqual([
    ["Guten Morgen!", "petra"],
    ["Hallo!", "anna"],
  ]);
  fireEvent.click(view.getByRole("button", { name: "pause" }));
  expect(view.getByText("at 1 · heard 0 · still")).toBeTruthy();
  // Played on from the line it was at.
  fireEvent.click(view.getByRole("button", { name: "play" }));
  await waitFor(() => expect(said).toHaveLength(3));
  expect(said[2]?.text).toBe("Hallo!");
  await finish();
  await waitFor(() => expect(said).toHaveLength(4));
  await finish();
  await waitFor(() => expect(view.getByText("at 0 · heard 1 · still")).toBeTruthy());
  fireEvent.click(view.getByRole("button", { name: "replay" }));
  await waitFor(() => expect(said).toHaveLength(5));
  expect(said[4]?.text).toBe("Guten Morgen!");
});

test("with Piper, the second speaker's lines are asked of another voice of the language; who reads is named with both", async () => {
  const asked: Array<{ text: string; voice?: string }> = [];
  const realFetch = globalThis.fetch;
  const realAudio = globalThis.Audio;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push((await request.json()) as { text: string; voice?: string });
    return new Response(new Blob([new Uint8Array([1])], { type: "audio/wav" }));
  }) as typeof fetch;
  (globalThis as { Audio: unknown }).Audio = class {
    onended?: () => void;
    async play() {
      setTimeout(() => this.onended?.(), 0);
    }
    pause() {}
  };
  const two = {
    ...PIPER,
    voices: PIPER.voices.map((v) =>
      v.id === "de_AT-hmm-low" ? { ...v, installed: true, downloaded: undefined } : v,
    ),
  };
  try {
    const view = await renderApp(
      <>
        <ReadByLabel lang="de" two />
        <Listener parts={DIALOGUE} />
      </>,
      {
        data: [
          [["settings"], { "speech.readEngine": "piper" }],
          [["piper-voices"], two],
        ],
      },
    );
    expect(view.getByText("Read by Piper · thorsten and hmm")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "play" }));
    await waitFor(() => expect(view.getByText("at 0 · heard 1 · still")).toBeTruthy());
    expect(asked.map((a) => [a.text, a.voice])).toEqual([
      ["Guten Morgen!", undefined],
      ["Hallo!", "de_AT-hmm-low"],
      ["Zwei Brötchen, bitte.", undefined],
    ]);
  } finally {
    globalThis.fetch = realFetch;
    (globalThis as { Audio: unknown }).Audio = realAudio;
  }
});

test("the second speaker by a voice of the other gender where the voices say theirs; every line asked for before the first ends", async () => {
  const asked: Array<{ text: string; voice?: string }> = [];
  const ends: Array<() => void> = [];
  const realFetch = globalThis.fetch;
  const realAudio = globalThis.Audio;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push((await request.json()) as { text: string; voice?: string });
    return new Response(new Blob([new Uint8Array([1])], { type: "audio/wav" }));
  }) as typeof fetch;
  (globalThis as { Audio: unknown }).Audio = class {
    onended?: () => void;
    async play() {
      ends.push(() => this.onended?.());
    }
    pause() {}
  };
  const voice = (id: string, name: string) => ({
    id,
    lang: "de",
    region: "DE",
    name,
    quality: "medium",
    bytes: 6e7,
    installed: true,
  });
  const three = {
    ...PIPER,
    voices: [
      voice("de_DE-thorsten-medium", "thorsten"),
      voice("de_DE-karlsson-low", "karlsson"),
      voice("de_DE-eva_k-x_low", "eva_k"),
    ],
  };
  try {
    const view = await renderApp(
      <>
        <ReadByLabel lang="de" two />
        <Listener parts={DIALOGUE} />
      </>,
      {
        data: [
          [["settings"], { "speech.readEngine": "piper" }],
          [["piper-voices"], three],
        ],
      },
    );
    // Thorsten reads; the other speaker not by Karlsson (a man too) but by Eva K.
    expect(view.getByText("Read by Piper · thorsten and eva k")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "play" }));
    await waitFor(() => expect(ends).toHaveLength(1));
    // The first line playing: the others asked for already, in order.
    await waitFor(() => expect(asked).toHaveLength(3));
    expect(asked.map((a) => [a.text, a.voice])).toEqual([
      ["Guten Morgen!", undefined],
      ["Hallo!", "de_DE-eva_k-x_low"],
      ["Zwei Brötchen, bitte.", undefined],
    ]);
    for (let i = 0; i < 3; i++) {
      await waitFor(() => expect(ends).toHaveLength(i + 1));
      act(() => ends[i]?.());
    }
    await waitFor(() => expect(view.getByText("at 0 · heard 1 · still")).toBeTruthy());
    // Asked once each: what was asked ahead is what is read.
    expect(asked).toHaveLength(3);
  } finally {
    globalThis.fetch = realFetch;
    (globalThis as { Audio: unknown }).Audio = realAudio;
  }
});
