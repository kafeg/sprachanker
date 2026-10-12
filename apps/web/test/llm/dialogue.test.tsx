// The Dialogue step (09): the goal card, who reads the partner's lines, a line said and heard (sent as
// heard, or said again), the learner's lines judged, the summary once it is over; typed only where
// nothing hears the line, saying why.
import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { type SpeechHost, SpeechProvider } from "../../src/audio/context.ts";
import type { SceneState } from "../../src/llm/api.ts";
import { DialogueStep } from "../../src/llm/dialogue.tsx";
import { DialogueLine, type DialogueLineInput } from "../../src/llm/dialogue-line.tsx";
import { claimPlayback } from "../../src/ui/playback.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
const llm: [unknown[], unknown] = [["llm"], { provider: "custom", model: "test-model" }];
const TAKE = "01K7A0Z8ZQ4J1V2W3X4Y5Z6A7B";

const g = globalThis as Record<string, unknown>;
const saved = {
  secure: Object.getOwnPropertyDescriptor(window, "isSecureContext"),
  recorder: g.MediaRecorder,
  context: g.AudioContext,
};
afterEach(() => {
  if (saved.secure) Object.defineProperty(window, "isSecureContext", saved.secure);
  g.MediaRecorder = saved.recorder;
  g.AudioContext = saved.context;
});

/** A page where the microphone records: each take is a little audio at the level given (a voice, or
 *  silence), stopped when asked. */
function microphoneHere(level = 0.2) {
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  g.MediaRecorder = class {
    static isTypeSupported = () => true;
    mimeType = "audio/webm";
    state = "inactive";
    ondataavailable?: (e: { data: Blob }) => void;
    onstop?: () => void;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["take"]) });
      this.onstop?.();
    }
  };
  g.AudioContext = class {
    createAnalyser = () => ({
      fftSize: 0,
      getFloatTimeDomainData: (a: Float32Array) => a.fill(level),
    });
    createMediaStreamSource = () => ({ connect() {} });
    close = async () => {};
  };
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: async () => ({ getTracks: () => [] }) },
    configurable: true,
  });
}

const host = (recognition: boolean, heard = "wann fährt der zug"): SpeechHost => ({
  save: async () => TAKE,
  src: (id) => `/api/recordings/${id}`,
  recognition,
  transcribe: async () => heard,
  warm() {},
});

const SETUP = {
  title: "Am Bahnhof",
  situation: "You are at the ticket office.",
  partner: "The clerk",
  goals: ["Ask when the train leaves", "Ask the price"],
  opening: "Guten Tag! Wohin möchten Sie?",
};
const dialogue = (extra: Partial<SceneState> = {}): SceneState => ({
  id: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
  startedAt: 1_790_000_000_000,
  setup: SETUP,
  turns: [
    { role: "assistant", text: SETUP.opening, goalsMet: [], ts: 1 },
    {
      role: "user",
      text: "wann fahrt der zug",
      spoken: true,
      recording: TAKE,
      understood: true,
      fits: false,
      corrections: [{ wrong: "fahrt", right: "fährt", explanation: "An umlaut." }],
      ts: 2,
    },
    { role: "assistant", text: "Um 14:30.", translation: "At 2:30 pm.", goalsMet: [0], ts: 3 },
  ],
  goalsMet: [0],
  done: false,
  summary: null,
  ...extra,
});

const PIPER = {
  engine: true,
  auto: { de: "de_DE-thorsten-medium" },
  voices: [{ id: "de_DE-thorsten-medium", lang: "de", installed: true }],
};

const step = (scene: SceneState, recognition = true) =>
  renderApp(
    <SpeechProvider value={host(recognition)}>
      <TargetLang value="de">
        <DialogueStep {...ids} />
      </TargetLang>
    </SpeechProvider>,
    {
      data: [
        llm,
        [["settings"], { "speech.readEngine": "piper" }],
        [["piper-voices"], PIPER],
        [["scenes", ids.lessonKey], { scenes: [scene], pending: null }],
      ],
    },
  );

test("an open Dialogue: its goal card, who reads the lines, the learner's line said with its take, judged and corrected", async () => {
  microphoneHere();
  const view = await step(dialogue());
  expect(view.getByText("Your goals")).toBeTruthy();
  expect(view.getByText("Ask when the train leaves").closest("li")?.className).toContain(
    "text-correct",
  );
  // Who reads the partner's lines, as the model is named.
  expect(view.getByText("Read by Piper · thorsten")).toBeTruthy();
  expect(view.getByText(/· test-model$/)).toBeTruthy();
  // A partner's line is played by a button named by the line.
  expect(view.getByRole("button", { name: "Read aloud: Um 14:30." })).toBeTruthy();
  // The learner's line: said, its take to play, understood but not fitting, its correction.
  expect(view.getByLabelText("Said aloud")).toBeTruthy();
  expect(view.getByRole("button", { name: "Mine" })).toBeTruthy();
  expect(view.getByText("Understood")).toBeTruthy();
  expect(view.getByText("Doesn't fit")).toBeTruthy();
  expect(view.getByText("fährt")).toBeTruthy();
  // What the partner knows stays hidden; the line goes by voice.
  expect(view.queryByText("What your partner knew")).toBeNull();
  expect(view.getByRole("button", { name: "Record yourself" })).toBeTruthy();
  expect(view.getByRole("button", { name: "End the dialogue" })).toBeTruthy();
  view.unmount();
});

test("a line said: what was heard is shown and sent as heard, with its take, kept until stored — or said again", async () => {
  microphoneHere();
  const sent: DialogueLineInput[] = [];
  let stored = () => {};
  const view = await renderApp(
    <SpeechProvider value={host(true)}>
      <DialogueLine
        lang="de"
        busy={false}
        onSend={(line, done) => {
          sent.push(line);
          stored = done;
        }}
      />
    </SpeechProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Record yourself" }));
  await waitFor(() => view.getByRole("button", { name: "Stop recording" }));
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Stop recording" }));
  });
  await waitFor(() => view.getByText("wann fährt der zug"));
  expect(view.getByText("Heard:")).toBeTruthy();
  // Not editable: no text box, only send it or say it again.
  expect(view.queryByRole("textbox")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Send" }));
  expect(sent).toEqual([{ text: "wann fährt der zug", spoken: true, recording: TAKE }]);
  // Not stored (the send failed): the line stays, to be sent again.
  expect(view.getByRole("button", { name: "Send" })).toBeTruthy();
  act(() => stored());
  expect(view.getByRole("button", { name: "Record yourself" })).toBeTruthy();
});

test("a silent take is not sent to be heard nor kept: nothing was heard, said again", async () => {
  microphoneHere(0);
  const asked: string[] = [];
  const view = await renderApp(
    <SpeechProvider
      value={{
        ...host(true, "Vielen Dank."),
        save: async () => {
          asked.push("save");
          return TAKE;
        },
        transcribe: async () => {
          asked.push("transcribe");
          return "Vielen Dank.";
        },
      }}
    >
      <DialogueLine lang="de" busy={false} onSend={() => {}} />
    </SpeechProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Record yourself" }));
  await waitFor(() => view.getByRole("button", { name: "Stop recording" }));
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Stop recording" }));
  });
  expect(view.getByText(/^Nothing was heard/)).toBeTruthy();
  expect(view.queryByText("Vielen Dank.")).toBeNull();
  expect(asked).toEqual([]);
});

test("recording stops what is read aloud or played: the microphone never hears the partner's line", async () => {
  microphoneHere();
  let paused = 0;
  const view = await renderApp(
    <SpeechProvider value={host(true)}>
      <DialogueLine lang="de" busy={false} onSend={() => {}} />
    </SpeechProvider>,
  );
  // The partner's line being read aloud (the speaker claims playback as any medium does).
  claimPlayback({ pause: () => paused++ });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Record yourself" }));
  });
  await waitFor(() => view.getByRole("button", { name: "Stop recording" }));
  expect(paused).toBe(1);
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Stop recording" }));
  });
  await waitFor(() => view.getByText("wann fährt der zug"));
  // "Say it again" while the line is read again: stopped too.
  claimPlayback({ pause: () => paused++ });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Say it again" }));
  });
  await waitFor(() => view.getByRole("button", { name: "Stop recording" }));
  expect(paused).toBe(2);
  view.unmount();
});

test("who reads the lines is named once known: nothing while the server's voices are asked for; the hint is a button", async () => {
  microphoneHere();
  const real = globalThis.fetch;
  // The server's voices not come yet.
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
  try {
    const view = await renderApp(
      <SpeechProvider value={host(true)}>
        <TargetLang value="de">
          <DialogueStep {...ids} />
        </TargetLang>
      </SpeechProvider>,
      {
        data: [
          llm,
          [["settings"], { "speech.readEngine": "piper" }],
          [["scenes", ids.lessonKey], { scenes: [dialogue()], pending: null }],
        ],
      },
    );
    expect(view.queryByText(/^Read by/)).toBeNull();
    view.unmount();
  } finally {
    globalThis.fetch = real;
  }
  const view = await step(dialogue());
  const label = view.getByRole("button", { name: "Read by Piper · thorsten" });
  // Reachable by keyboard and by a tap: the hint shows where to change it.
  fireEvent.click(label);
  await waitFor(() =>
    expect(view.getAllByText(/chosen in Settings → Speech/).length).toBeGreaterThan(0),
  );
  view.unmount();
});

test("without recognition the line is typed, saying why", async () => {
  microphoneHere();
  const view = await step(dialogue(), false);
  expect(view.getByText(/Speech recognition is off or not installed/)).toBeTruthy();
  expect(view.getByPlaceholderText("Your line…")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Record yourself" })).toBeNull();
  view.unmount();
});

test("without a microphone (plain HTTP) the line is typed, saying why", async () => {
  Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
  const view = await step(dialogue());
  expect(view.getByText(/works only at a secure address/)).toBeTruthy();
  expect(view.getByPlaceholderText("Your line…")).toBeTruthy();
  view.unmount();
});

test("a Dialogue over: the goals met, what the partner knew, the key corrections with a model line, the feedback", async () => {
  microphoneHere();
  const view = await step(
    dialogue({
      done: true,
      setup: { ...SETUP, partnerInfo: ["Der Zug fährt um 14:30."] },
      summary: {
        corrections: [
          {
            wrong: "fahrt",
            right: "fährt",
            explanation: "An umlaut.",
            model: "Wann fährt der Zug?",
          },
        ],
        feedback: "Well asked.",
        model: "test-model",
      },
    }),
  );
  expect(view.getByText("Dialogue ended.")).toBeTruthy();
  expect(view.getAllByText("Goals: 1 of 2").length).toBeGreaterThan(0);
  expect(view.getByText("What your partner knew")).toBeTruthy();
  expect(view.getByText("Der Zug fährt um 14:30.")).toBeTruthy();
  expect(view.getByText("Wann fährt der Zug?")).toBeTruthy();
  expect(view.getByText("Well asked.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Record yourself" })).toBeNull();
  view.unmount();
});

test("a Dialogue just over: its last line shown while its summary is made", async () => {
  microphoneHere();
  const view = await renderApp(
    <SpeechProvider value={host(true)}>
      <TargetLang value="de">
        <DialogueStep {...ids} />
      </TargetLang>
    </SpeechProvider>,
    {
      data: [
        llm,
        [["settings"], { "speech.readEngine": "piper" }],
        [["piper-voices"], PIPER],
        [
          ["scenes", ids.lessonKey],
          { scenes: [dialogue({ done: true })], pending: { summing: true } },
        ],
      ],
    },
  );
  expect(view.getByText("Um 14:30.")).toBeTruthy();
  expect(view.getByText("Summing up…")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Sum it up" })).toBeNull();
  view.unmount();
});

test("a Dialogue over without its summary offers to sum it up again", async () => {
  microphoneHere();
  const view = await step(dialogue({ done: true }));
  expect(view.getByText("The summary could not be made.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Sum it up" })).toBeTruthy();
  view.unmount();
});

test("a Dialogue that could not begin: said, with Try again asking it again", async () => {
  microphoneHere();
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push(new URL(request.url).pathname);
    return Response.json({ error: "llm_unreachable" }, { status: 502 });
  }) as typeof fetch;
  try {
    const view = await renderApp(
      <SpeechProvider value={host(true)}>
        <TargetLang value="de">
          <DialogueStep {...ids} />
        </TargetLang>
      </SpeechProvider>,
      {
        data: [
          llm,
          [["settings"], { "speech.readEngine": "piper" }],
          [["piper-voices"], PIPER],
          [["scenes", ids.lessonKey], { scenes: [], pending: null }],
        ],
      },
    );
    fireEvent.click(view.getByRole("button", { name: "Start a dialogue" }));
    fireEvent.click(await view.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(asked).toEqual(["/api/llm/scene/start", "/api/llm/scene/start"]));
    view.unmount();
  } finally {
    globalThis.fetch = real;
  }
});
