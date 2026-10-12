import { afterEach, expect, test } from "bun:test";
import type { ItemKey } from "@sprachanker/schema";
import { act, fireEvent } from "@testing-library/react";
import { SpeechProvider } from "../../src/audio/context.ts";
import { SpeechRepeat, SpeechSelfrate } from "../../src/exercises/speech.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
afterEach(() => {
  if (secure) Object.defineProperty(window, "isSecureContext", secure);
});
const setSecure = (value: boolean) =>
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });

const host = () => ({
  save: async () => "01K00000000000000000000000",
  src: (id: string) => `/api/recordings/${id}`,
  recognition: true,
  transcribe: async () => "",
  warm() {},
});
const item = {
  key: "s/c/00-01/ex-01#1" as ItemKey,
  text: "Guten Tag!",
  media: { audio: "a.mp3" },
};

test("on plain HTTP the microphone is disabled and says why", async () => {
  setSecure(false);
  const view = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate item={item} answer={undefined} onAnswer={() => {}} url={(p) => p} />
    </SpeechProvider>,
  );
  expect(view.getByRole("button", { name: "Record yourself" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(view.getByText(/only at a secure address/)).toBeTruthy();
});

test("the phrase hidden until the first try, shown on request; a kept take plays in the Notebook", async () => {
  setSecure(true);
  const view = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate
        item={item}
        answer={undefined}
        onAnswer={() => {}}
        url={(p) => p}
        listen
        heard={false}
      />
    </SpeechProvider>,
  );
  expect(view.getByText("Guten Tag!").getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(view.getByRole("button", { name: "Show the text" }));
  expect(view.getByText("Guten Tag!").getAttribute("aria-hidden")).toBe("false");
  view.unmount();

  // Nothing to hear first (a recording the source keeps locked): the phrase is shown at once.
  const silent = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate
        item={{ key: item.key, text: "Guten Tag!" }}
        answer={undefined}
        onAnswer={() => {}}
        url={(p) => p}
      />
    </SpeechProvider>,
  );
  expect(silent.getByText("Guten Tag!").getAttribute("aria-hidden")).toBe("false");
  expect(silent.queryByRole("button", { name: "Show the text" })).toBeNull();
  silent.unmount();

  const notebook = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate
        item={item}
        answer={{ recording: "01K00000000000000000000000" }}
        onAnswer={() => {}}
        url={(p) => p}
        readOnly
      />
    </SpeechProvider>,
  );
  expect(notebook.getByRole("button", { name: "Mine" })).toBeTruthy();
  expect(notebook.queryByRole("button", { name: "Record yourself" })).toBeNull();
  notebook.unmount();

  // All recordings deleted (the answers kept): the take is said to be gone, nothing to play.
  const deleted = await renderApp(
    <SpeechProvider value={{ ...host(), kept: () => false }}>
      <SpeechSelfrate
        item={item}
        answer={{ recording: "01K00000000000000000000000" }}
        onAnswer={() => {}}
        url={(p) => p}
        readOnly
      />
    </SpeechProvider>,
  );
  expect(deleted.getByText("Your recording was deleted")).toBeTruthy();
  expect(deleted.queryByRole("button", { name: "Mine" })).toBeNull();
});

test("what was heard: the verdict and the words missed against the phrase; a free answer just heard", async () => {
  setSecure(true);
  const view = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate
        item={{ ...item, text: "Ich heiße Nico und komme aus Spanien." }}
        answer={{ transcript: "Ich heiße Nico und komme aus" }}
        onAnswer={() => {}}
        url={(p) => p}
        readOnly
      />
    </SpeechProvider>,
  );
  expect(view.getByText("Almost: a few words missing")).toBeTruthy();
  expect(view.getByText("Ich heiße Nico und komme aus")).toBeTruthy();
  expect(view.getByText(/^Spanien/).className).toContain("text-wrong");
  view.unmount();

  const free = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate
        item={{ key: item.key, answerAudio: "answer.mp3" }}
        answer={{ transcript: "Tschüss, gute Reise!" }}
        onAnswer={() => {}}
        url={(p) => p}
        readOnly
      />
    </SpeechProvider>,
  );
  expect(free.getByText("Tschüss, gute Reise!")).toBeTruthy();
  expect(free.queryByText(/You said it|Almost|Try again/)).toBeNull();
  // The source's own answer, after the learner's.
  expect(free.getByRole("button", { name: "Sample" })).toBeTruthy();
  free.unmount();

  // An answer to a question: heard against the source's line (the closer alternative), shown at
  // once; its frame is no line to compare with.
  const answered = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate
        item={{
          key: item.key,
          prompt: "Warst du schon in Berlin?",
          reference: ["Ja, ich war schon in Berlin. / Nein, ich war noch nie in Berlin."],
        }}
        answer={{ transcript: "Nein, ich war noch nie in Berlin" }}
        onAnswer={() => {}}
        url={(p) => p}
        readOnly
      />
    </SpeechProvider>,
  );
  expect(answered.getByText("You said it")).toBeTruthy();
  answered.unmount();
  const framed = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate
        item={{ key: item.key, reference: ["Ja, ich … / Nein, ich …"] }}
        answer={{ transcript: "Ja, ich war schon in Berlin" }}
        onAnswer={() => {}}
        url={(p) => p}
        readOnly
      />
    </SpeechProvider>,
  );
  expect(framed.getByText("Ja, ich … / Nein, ich …")).toBeTruthy();
  expect(framed.queryByText(/You said it|Almost|Try again/)).toBeNull();
});

test("the source's answer is not offered before the first try", async () => {
  setSecure(true);
  const view = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechSelfrate
        item={{ key: item.key, answerAudio: "answer.mp3" }}
        answer={undefined}
        onAnswer={() => {}}
        url={(p) => p}
      />
    </SpeechProvider>,
  );
  expect(view.queryByRole("button", { name: "Sample" })).toBeNull();
});

test("saying a phrase: shown at once; without recognition the microphone says why; what was heard checked against it", async () => {
  setSecure(true);
  const phrase = { key: item.key, text: "Wie geht es Ihnen?" };
  const off = await renderApp(
    <SpeechProvider value={{ ...host(), recognition: false }}>
      <SpeechRepeat item={phrase} answer={undefined} onAnswer={() => {}} url={(p) => p} />
    </SpeechProvider>,
  );
  expect(off.getByText("Wie geht es Ihnen?")).toBeTruthy();
  expect(off.getByRole("button", { name: "Record yourself" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(off.getByText(/needs speech recognition/)).toBeTruthy();
  off.unmount();

  const said = await renderApp(
    <SpeechProvider value={host()}>
      <SpeechRepeat
        item={phrase}
        answer={{ speech: { transcript: "Wie geht es" } }}
        onAnswer={() => {}}
        url={(p) => p}
      />
    </SpeechProvider>,
  );
  // Three words of four: under the share for "almost".
  expect(said.getByText(/^Try again/)).toBeTruthy();
});

/** A microphone that hears the level given (a constant waveform), recorded by a MediaRecorder on
 *  paper; what getUserMedia was asked. */
function microphone(level: number) {
  const asked: MediaStreamConstraints[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = { recorder: g.MediaRecorder, context: g.AudioContext };
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: async (c: MediaStreamConstraints) => {
        asked.push(c);
        return { getTracks: () => [] };
      },
    },
    configurable: true,
  });
  g.MediaRecorder = class {
    static isTypeSupported = () => true;
    state = "inactive";
    mimeType = "audio/webm";
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
      fftSize: 512,
      getFloatTimeDomainData: (a: Float32Array) => a.fill(level),
    });
    createMediaStreamSource = () => ({ connect() {} });
    close = async () => {};
  };
  return {
    asked,
    restore() {
      g.MediaRecorder = saved.recorder;
      g.AudioContext = saved.context;
    },
  };
}

test("a take nothing loud was in: neither kept nor heard, said again; the browser's processing of the microphone off", async () => {
  setSecure(true);
  for (const level of [0.001, 0.2]) {
    const mic = microphone(level);
    const done = { saved: 0, heard: 0, answers: 0 };
    const view = await renderApp(
      <SpeechProvider
        value={{
          ...host(),
          save: async () => {
            done.saved++;
            return "01K00000000000000000000000";
          },
          transcribe: async () => {
            done.heard++;
            return "Guten Tag";
          },
        }}
      >
        <TargetLang value="de">
          <SpeechSelfrate
            item={{ key: item.key, text: "Guten Tag!" }}
            answer={undefined}
            onAnswer={() => done.answers++}
            url={(p) => p}
          />
        </TargetLang>
      </SpeechProvider>,
    );
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Record yourself" }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Stop recording" }));
    });
    expect(mic.asked[0]?.audio).toMatchObject({
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: false,
    });
    if (level < 0.01) {
      expect(view.getByText(/^Nothing was heard/)).toBeTruthy();
      expect(done).toEqual({ saved: 0, heard: 0, answers: 0 });
    } else {
      expect(view.queryByText(/^Nothing was heard/)).toBeNull();
      expect(done).toEqual({ saved: 1, heard: 1, answers: 1 });
    }
    view.unmount();
    mic.restore();
  }
});

/** A take recorded: the microphone tapped, tapped again. */
async function recordTake(view: Awaited<ReturnType<typeof renderApp>>) {
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Record yourself" }));
  });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Stop recording" }));
  });
}

test("a take the server heard nothing in is neither kept nor the answer; the lines to say go with it; a loudness not measured is the server's to judge", async () => {
  setSecure(true);
  for (const level of [0.2, 0]) {
    const mic = microphone(level);
    const done = { saved: 0, answers: 0, expected: [] as unknown[] };
    const view = await renderApp(
      <SpeechProvider
        value={{
          ...host(),
          save: async () => {
            done.saved++;
            return "01K00000000000000000000000";
          },
          transcribe: async (_take, _lang, expected) => {
            done.expected.push(expected);
            return "";
          },
        }}
      >
        <TargetLang value="de">
          <SpeechSelfrate
            item={{ key: item.key, reference: ["Danke!", "Danke schön!"] }}
            answer={undefined}
            onAnswer={() => done.answers++}
            url={(p) => p}
          />
        </TargetLang>
      </SpeechProvider>,
    );
    await recordTake(view);
    expect(view.getByText(/^Nothing was heard/)).toBeTruthy();
    expect(view.queryByRole("button", { name: /^Mine/ })).toBeNull();
    expect(done).toEqual({ saved: 0, answers: 0, expected: [["Danke!", "Danke schön!"]] });
    view.unmount();
    mic.restore();
  }
});

test("a take neither kept nor heard (both failing) is no answer over an earlier one", async () => {
  setSecure(true);
  const mic = microphone(0.2);
  const answers: unknown[] = [];
  const view = await renderApp(
    <SpeechProvider
      value={{
        ...host(),
        save: () => Promise.reject(new Error("full")),
        transcribe: () => Promise.reject(new Error("engine")),
      }}
    >
      <TargetLang value="de">
        <SpeechSelfrate
          item={item}
          answer={{ recording: "01K00000000000000000000000", transcript: "Guten Tag" }}
          onAnswer={(a) => answers.push(a)}
          url={(p) => p}
        />
      </TargetLang>
    </SpeechProvider>,
  );
  await recordTake(view);
  expect(answers).toEqual([]);
  expect(view.getByText(/^The recording couldn't be saved/)).toBeTruthy();
  view.unmount();
  mic.restore();
});

test("Next pressed while a take is heard: the take is still the item's answer", async () => {
  setSecure(true);
  const mic = microphone(0.2);
  const answers: unknown[] = [];
  let heard = (_: string) => {};
  const view = await renderApp(
    <SpeechProvider
      value={{
        ...host(),
        transcribe: () =>
          new Promise<string>((resolve) => {
            heard = resolve;
          }),
      }}
    >
      <TargetLang value="de">
        <SpeechSelfrate
          item={item}
          answer={undefined}
          onAnswer={(a) => answers.push(a)}
          url={(p) => p}
        />
      </TargetLang>
    </SpeechProvider>,
  );
  await recordTake(view);
  expect(view.getByText("Listening to it…")).toBeTruthy();
  view.unmount();
  await act(async () => heard("Guten Tag"));
  expect(answers).toEqual([{ recording: "01K00000000000000000000000", transcript: "Guten Tag" }]);
  mic.restore();
});
