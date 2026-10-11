import { afterEach, expect, test } from "bun:test";
import type { ItemKey } from "@sprachanker/schema";
import { fireEvent } from "@testing-library/react";
import { SpeechProvider } from "../../src/audio/context.ts";
import { SpeechRepeat, SpeechSelfrate } from "../../src/exercises/speech.tsx";
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
