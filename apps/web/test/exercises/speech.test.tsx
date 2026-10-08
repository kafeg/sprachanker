import { afterEach, expect, test } from "bun:test";
import type { ItemKey } from "@sprachanker/schema";
import { fireEvent } from "@testing-library/react";
import { SpeechProvider } from "../../src/audio/context.ts";
import { SpeechSelfrate } from "../../src/exercises/speech.tsx";
import { renderApp } from "../render.tsx";

const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
afterEach(() => {
  if (secure) Object.defineProperty(window, "isSecureContext", secure);
});
const setSecure = (value: boolean) =>
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });

const host = (showText: "after" | "always") => ({
  keepRecordings: true,
  showText,
  save: async () => "01K00000000000000000000000",
  src: (id: string) => `/api/recordings/${id}`,
});
const item = {
  key: "s/c/00-01/ex-01#1" as ItemKey,
  text: "Guten Tag!",
  media: { audio: "a.mp3" },
};

test("on plain HTTP the microphone is disabled and says why", async () => {
  setSecure(false);
  const view = await renderApp(
    <SpeechProvider value={host("always")}>
      <SpeechSelfrate item={item} answer={undefined} onAnswer={() => {}} url={(p) => p} />
    </SpeechProvider>,
  );
  expect(view.getByRole("button", { name: "Record yourself" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  expect(view.getByText(/only at a secure address/)).toBeTruthy();
  // Shown at once by the setting.
  expect(view.getByText("Guten Tag!").getAttribute("aria-hidden")).toBe("false");
});

test("the phrase hidden until the first try, shown on request; a kept take plays in the Notebook", async () => {
  setSecure(true);
  const view = await renderApp(
    <SpeechProvider value={host("after")}>
      <SpeechSelfrate
        item={item}
        answer={undefined}
        onAnswer={() => {}}
        url={(p) => p}
        heard={false}
      />
    </SpeechProvider>,
  );
  expect(view.getByText("Guten Tag!").getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(view.getByRole("button", { name: "Show the text" }));
  expect(view.getByText("Guten Tag!").getAttribute("aria-hidden")).toBe("false");
  view.unmount();

  const notebook = await renderApp(
    <SpeechProvider value={host("after")}>
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
