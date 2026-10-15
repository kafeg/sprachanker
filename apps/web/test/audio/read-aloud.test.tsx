import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import { useListening } from "../../src/audio/listening.ts";
import { ReadAloud } from "../../src/audio/read-aloud-settings.tsx";
import { ReadByLabel } from "../../src/audio/read-by.tsx";
import { useReadLanguages } from "../../src/audio/read-languages.ts";
import type { SpokenPart } from "../../src/audio/speak.ts";
import { SpeakButton } from "../../src/audio/speak-button.tsx";
import { useSpeaker } from "../../src/audio/speaker.ts";
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

test("a recording that cannot be had: its line said by a voice instead", async () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
  try {
    const view = await renderApp(
      <SpeakButton
        parts={[{ text: "Hier bitte.", lang: "de", src: "/library/s/practice/x/1.wav" }]}
        label="x"
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Read aloud: x" }));
    await waitFor(() => expect(said.map((s) => s.text)).toEqual(["Hier bitte."]));
    expect(asked).toEqual(["/library/s/practice/x/1.wav"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Settings: Qwen3-TTS alone — its models (the one in use), each language's speaker; a language it lacks said so", async () => {
  const view = await renderApp(<ReadAloud />, {
    data: [
      installed("en-de", "en-ar"),
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
          wordModel: { id: "base", bytes: 2079e6, installed: false },
          words: {},
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
  // A model removed as a model, not as a voice.
  expect(within(row(/Small model/)).getByRole("button", { name: "Remove the model" })).toBeTruthy();
  // Each language its own speaker (automatic: the default one).
  expect(view.getByRole("combobox", { name: "Voice for German" }).textContent).toBe(
    "Automatic — Ryan",
  );
  expect(view.getByText(/Qwen3-TTS does not speak Arabic/)).toBeTruthy();
  // No other engine to choose, no speed (it has none of its own).
  expect(view.queryByText("This device's voices")).toBeNull();
  expect(view.queryByText(/^Speed:/)).toBeNull();
});

test("Settings without Qwen3-TTS here: said so, nothing to choose", async () => {
  const view = await renderApp(<ReadAloud />, { data: [installed("en-de")] });
  expect(view.getByText(/Not in this build/)).toBeTruthy();
  expect(view.queryByRole("combobox")).toBeNull();
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

/** Another reading: a word's "listen" while a text is listened to. */
function Word() {
  const speaker = useSpeaker();
  return (
    <button type="button" onClick={() => void speaker.say("word", [{ text: "Wort.", lang: "de" }])}>
      word
    </button>
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
    view.unmount();
    // Both speakers men by their names ("Herr Weber", "Jonas"): the other one by another man's voice.
    const men = await renderApp(<ReadByLabel lang="de" two="m" />, {
      data: [
        [["settings"], { "speech.readEngine": "piper" }],
        [["piper-voices"], three],
      ],
    });
    expect(men.getByText("Read by Piper · thorsten and karlsson")).toBeTruthy();
    men.unmount();
    // Two women and a man's voice: neither by it — each by a woman's voice of her own.
    const women = await renderApp(<ReadByLabel lang="de" two={["f", "f2"]} />, {
      data: [
        [["settings"], { "speech.readEngine": "piper" }],
        [
          ["piper-voices"],
          { ...three, voices: [...three.voices, voice("de_DE-kerstin-low", "kerstin")] },
        ],
      ],
    });
    expect(women.getByText("Read by Piper · eva k and kerstin")).toBeTruthy();
  } finally {
    globalThis.fetch = realFetch;
    (globalThis as { Audio: unknown }).Audio = realAudio;
  }
});

test("a long text listened to: only the next few lines asked for ahead, those let go when it is paused or left", async () => {
  const asked: Array<{ text: string; signal?: AbortSignal | null }> = [];
  const ends: Array<() => void> = [];
  const realFetch = globalThis.fetch;
  const realAudio = globalThis.Audio;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push({ ...((await request.json()) as { text: string }), signal: init?.signal });
    return new Response(new Blob([new Uint8Array([1])], { type: "audio/wav" }));
  }) as typeof fetch;
  (globalThis as { Audio: unknown }).Audio = class {
    onended?: () => void;
    async play() {
      ends.push(() => this.onended?.());
    }
    pause() {}
  };
  const lines = ["Eins.", "Zwei.", "Drei.", "Vier.", "Fünf.", "Sechs."].map((text) => ({
    text,
    lang: "de",
  }));
  try {
    const view = await renderApp(
      <>
        <Listener parts={lines} />
        <Word />
      </>,
      {
        data: [
          [["settings"], { "speech.readEngine": "piper" }],
          [["piper-voices"], PIPER],
        ],
      },
    );
    fireEvent.click(view.getByRole("button", { name: "play" }));
    await waitFor(() => expect(ends).toHaveLength(1));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    // The first line playing: it and the next two asked for, no more.
    expect(asked.map((a) => a.text)).toEqual(["Eins.", "Zwei.", "Drei."]);
    act(() => ends[0]?.());
    await waitFor(() => expect(ends).toHaveLength(2));
    await waitFor(() => expect(asked.map((a) => a.text)).toContain("Vier."));
    expect(asked).toHaveLength(4);
    // Paused: what was asked for ahead and not read is let go.
    fireEvent.click(view.getByRole("button", { name: "pause" }));
    const waiting = asked.filter((a) => a.text === "Drei." || a.text === "Vier.");
    expect(waiting.every((a) => a.signal?.aborted)).toBe(true);
    // Played on from its line: asked again, the next few only.
    fireEvent.click(view.getByRole("button", { name: "play" }));
    await waitFor(() => expect(ends).toHaveLength(3));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(asked.slice(4).map((a) => a.text)).toEqual(["Zwei.", "Drei.", "Vier."]);
    // Another reading interrupts it: what was asked for ahead goes too, the word is asked for.
    fireEvent.click(view.getByRole("button", { name: "word" }));
    expect(asked.slice(5).every((a) => a.signal?.aborted)).toBe(true);
    await waitFor(() => expect(asked.at(-1)?.text).toBe("Wort."));
    // Left: the reading and what it asked for ahead stop.
    view.unmount();
    expect(asked.slice(5).every((a) => a.signal?.aborted)).toBe(true);
  } finally {
    globalThis.fetch = realFetch;
    (globalThis as { Audio: unknown }).Audio = realAudio;
  }
});
