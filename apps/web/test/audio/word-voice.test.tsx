import { afterEach, beforeEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ReadAloud } from "../../src/audio/read-aloud-settings.tsx";
import { renderApp } from "../render.tsx";

/** Qwen3-TTS here, its large model there; the Base model for words as given, the voices for words. */
const qwen = (installed: boolean, words: Record<string, unknown> = {}) => ({
  engine: true,
  models: [{ id: "1.7b", bytes: 2043e6, installed: true, inUse: true }],
  languages: ["de", "en"],
  speakers: ["ryan", "serena"],
  defaultSpeaker: "ryan",
  wordModel: { id: "base", bytes: 2079e6, installed },
  words,
});
const KAFFEE = {
  series: "dw.nicos-weg",
  path: "media/audio/kaffee.mp3",
  text: "Ich nehme Kaffee mit Milch und wenig Zucker bitte.",
};
const TISCH = {
  series: "dw.nicos-weg",
  path: "media/audio/tisch.mp3",
  text: "Der Tisch und die Stühle stehen in der Küche.",
};
const catalog: [unknown[], unknown] = [
  ["catalog"],
  [{ series: "dw.nicos-weg", edition: "en-de", installed: true }],
];

/** What the server was asked (method, path and query, a body's kind), answering each by `answer`. */
function server(answer: (path: string) => Response | Promise<Response>) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const type = request.headers.get("content-type") ?? "";
    const body =
      request.method === "POST" ? (type.includes("json") ? await request.text() : type) : "";
    asked.push(`${request.method} ${url.pathname}${url.search} ${body}`.trim());
    return answer(url.pathname);
  }) as typeof fetch;
  return asked;
}

// WebAudio as far as a recording is decoded: a second of 24 kHz, half of it said.
const realContext = (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
beforeEach(() => {
  (globalThis as { OfflineAudioContext: unknown }).OfflineAudioContext = class {
    constructor(
      readonly channels: number,
      readonly length: number,
      readonly rate: number,
    ) {}
    async decodeAudioData() {
      return { duration: 1 };
    }
    createBufferSource() {
      return { connect() {}, start() {}, buffer: null };
    }
    get destination() {
      return {};
    }
    async startRendering() {
      const samples = new Float32Array(this.length);
      samples.fill(0.5, this.length / 4, (this.length * 3) / 4);
      return { getChannelData: () => samples };
    }
  };
});
afterEach(() => {
  (globalThis as { OfflineAudioContext: unknown }).OfflineAudioContext = realContext;
});

test("the voice for words: its Base model downloaded from Settings like the others", async () => {
  const asked = server(() => Response.json(qwen(false)));
  const view = await renderApp(<ReadAloud />, { data: [catalog, [["qwen-tts"], qwen(false)]] });
  expect(view.getByText("Voice for words")).toBeTruthy();
  const row = view
    .getByText("Base model (1.7B): a native voice for words")
    .closest("li") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: /Download/ }));
  await waitFor(() => expect(asked).toContain("POST /api/speech/qwen/models/base"));
  // Nothing to choose until the model is there.
  expect(view.queryByRole("combobox", { name: /Recording for/ })).toBeNull();
});

test("the voice for words of a language, in the speakers' row: its recording chosen from a list, heard as it is, Listen reads the text below in the voice", async () => {
  const words = { de: { id: "abc", ...KAFFEE } };
  const asked = server((path) =>
    path === "/api/speech/say"
      ? new Response(new Blob([new Uint8Array([1])], { type: "audio/wav" }))
      : path.endsWith(".mp3")
        ? new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }))
        : Response.json(qwen(true, { de: { id: "def", ...TISCH } })),
  );
  const played: string[] = [];
  const realAudio = globalThis.Audio;
  (globalThis as { Audio: unknown }).Audio = class {
    paused = true;
    currentTime = 0;
    playbackRate = 1;
    constructor(readonly src: string) {}
    async play() {
      played.push(this.src);
    }
    pause() {}
  };
  try {
    const view = await renderApp(<ReadAloud />, {
      data: [
        catalog,
        [["qwen-tts"], qwen(true, words)],
        [
          ["word-candidates", "de"],
          [KAFFEE, TISCH],
        ],
        [["word-candidates", "en"], []],
      ],
    });
    const pick = view.getByRole("combobox", { name: "Recording for the German voice" });
    expect(pick.textContent).toBe(KAFFEE.text);
    // English: no course of it here to take a voice from.
    expect(view.getByText("No course in English here to take a voice from.")).toBeTruthy();

    // The recording as it is.
    fireEvent.click(view.getByRole("button", { name: /Course recording/ }));
    expect(played).toEqual(["/library/dw.nicos-weg/media/audio/kaffee.mp3"]);

    // Listen reads what the box below holds: a word first, then the learner's own text.
    const row = within(pick.closest("div.border-t") as HTMLElement);
    const box = row.getByRole("textbox", { name: /German/ });
    expect((box as HTMLTextAreaElement).value).toBe("der Kühlschrank");
    fireEvent.change(box, { target: { value: "die Stühle" } });
    fireEvent.click(row.getByRole("button", { name: /Listen/ }));
    await waitFor(() =>
      expect(asked).toContain(
        `POST /api/speech/say ${JSON.stringify({ text: "die Stühle", lang: "de", use: "words" })}`,
      ),
    );

    // Another recording chosen from the list: taken as 24 kHz WAV.
    fireEvent.click(pick);
    const options = await view.findAllByRole("option");
    expect(options.map((o) => [o.textContent, o.getAttribute("lang")])).toEqual([
      [KAFFEE.text, "de"],
      [TISCH.text, "de"],
    ]);
    fireEvent.click(view.getByRole("option", { name: TISCH.text }));
    await waitFor(() =>
      expect(asked).toContain(
        `POST /api/speech/words/de?${new URLSearchParams({ series: TISCH.series, path: TISCH.path })} audio/wav`,
      ),
    );
    expect(asked).toContain("GET /library/dw.nicos-weg/media/audio/tisch.mp3");
    await waitFor(() => expect(pick.textContent).toBe(TISCH.text));
  } finally {
    (globalThis as { Audio: unknown }).Audio = realAudio;
  }
});

test("no voice for words yet: the first recording proposed is taken by itself", async () => {
  const asked = server((path) =>
    path.endsWith(".mp3")
      ? new Response(new Blob([new Uint8Array([1])], { type: "audio/mpeg" }))
      : Response.json(qwen(true, { de: { id: "abc", ...KAFFEE } })),
  );
  const view = await renderApp(<ReadAloud />, {
    data: [
      catalog,
      [["qwen-tts"], qwen(true)],
      [
        ["word-candidates", "de"],
        [KAFFEE, TISCH],
      ],
      [["word-candidates", "en"], []],
    ],
  });
  await waitFor(() =>
    expect(view.getByRole("combobox", { name: "Recording for the German voice" }).textContent).toBe(
      KAFFEE.text,
    ),
  );
  expect(asked.filter((a) => a.startsWith("POST /api/speech/words/de"))).toEqual([
    `POST /api/speech/words/de?${new URLSearchParams({ series: KAFFEE.series, path: KAFFEE.path })} audio/wav`,
  ]);
});

test("a recording that cannot be taken: said so, and another one chosen from the list", async () => {
  const asked = server((path) =>
    path.endsWith("kaffee.mp3")
      ? Response.json({ error: "not_found" }, { status: 404 })
      : path.endsWith(".mp3")
        ? new Response(new Blob([new Uint8Array([1])], { type: "audio/mpeg" }))
        : Response.json(qwen(true, { de: { id: "def", ...TISCH } })),
  );
  const view = await renderApp(<ReadAloud />, {
    data: [
      catalog,
      [["qwen-tts"], qwen(true)],
      [
        ["word-candidates", "de"],
        [KAFFEE, TISCH],
      ],
      [["word-candidates", "en"], []],
    ],
  });
  await view.findByText("This recording is gone.");
  fireEvent.click(view.getByRole("combobox", { name: "Recording for the German voice" }));
  fireEvent.click(await view.findByRole("option", { name: TISCH.text }));
  await waitFor(() =>
    expect(asked.filter((a) => a.startsWith("POST /api/speech/words/de"))).toEqual([
      `POST /api/speech/words/de?${new URLSearchParams({ series: TISCH.series, path: TISCH.path })} audio/wav`,
    ]),
  );
});
