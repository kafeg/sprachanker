import { afterEach, beforeEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { type Picked, SelectionMenu } from "../../src/audio/selection-menu.tsx";
import { SelectionTranslate } from "../../src/llm/selection-translate.tsx";
import { renderApp } from "../render.tsx";
import { server } from "./practice-lesson.ts";

const llm = { provider: "custom", model: "m", providers: [] };
let said: Array<{ text: string; lang: string }> = [];

beforeEach(() => {
  said = [];
  const g = globalThis as Record<string, unknown>;
  g.SpeechSynthesisUtterance = class {
    lang = "";
    rate = 1;
    onend?: () => void;
    constructor(readonly text: string) {}
  };
  g.speechSynthesis = {
    getVoices: () => [
      { voiceURI: "anna", name: "Anna", lang: "de-DE", localService: true, default: true },
    ],
    addEventListener() {},
    removeEventListener() {},
    speak: (u: { text: string; lang: string }) => said.push({ text: u.text, lang: u.lang }),
    cancel() {},
  };
});
afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.speechSynthesis;
  delete g.SpeechSynthesisUtterance;
  window.getSelection()?.removeAllRanges();
});

/** The bar as the router mounts it — Translate only while a model is set up —, over a German
 *  sentence; its word selected. */
async function selected(model: { model: string | null; [key: string]: unknown }) {
  const view = await renderApp(
    <>
      <p lang="de">Das ist eine schwierige Situation.</p>
      <SelectionMenu
        extra={
          model.model
            ? (picked: Picked) => <SelectionTranslate key={picked.text} picked={picked} />
            : undefined
        }
      />
    </>,
    { data: [[["llm"], model]] },
  );
  const text = view.getByText("Das ist eine schwierige Situation.").firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 24);
  range.setEnd(text, 33);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await view.findByRole("toolbar");
  return view;
}

test("with a model the bar has one action, Translate: the model's card shown, said aloud, kept in Finds", async () => {
  const asked = server(() => ({
    target: "die Situation",
    translation: "ситуация",
    from: "target",
    lang: "de",
    audio: null,
    added: true,
  }));
  const view = await selected(llm);
  // One action: Translate reads the language learnt aloud itself.
  expect(view.queryByText("Read aloud")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /Translate/ }));
  await view.findByText("Added to Finds");
  expect(asked).toEqual([
    `POST /api/llm/finds ${JSON.stringify({
      text: "Situation",
      context: "Das ist eine schwierige Situation.",
      lang: "de",
    })}`,
  ]);
  expect(view.getByText("die Situation").getAttribute("lang")).toBe("de");
  expect(view.getByText(/— ситуация/)).toBeTruthy();
  // Said once the device's voice is chosen (slower under a full run's load).
  await waitFor(() => expect(said).toEqual([{ text: "die Situation", lang: "de-DE" }]), {
    timeout: 3000,
  });
});

test("a word among the cards already: said so; a failure in words, with Try again", async () => {
  let fail = true;
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push(`${request.method} ${new URL(request.url).pathname}`);
    return fail
      ? Response.json({ error: "llm_unreachable" }, { status: 502 })
      : Response.json({
          target: "die Situation",
          translation: "ситуация",
          from: "target",
          lang: "de",
          audio: null,
          added: false,
        });
  }) as typeof fetch;
  const view = await selected(llm);
  fireEvent.click(view.getByRole("button", { name: /Translate/ }));
  const retry = await view.findByRole("button", { name: "Try again" });
  fail = false;
  fireEvent.click(retry);
  await view.findByText("Already in your cards");
  expect(asked).toEqual(["POST /api/llm/finds", "POST /api/llm/finds"]);
});

test("without a model the bar only reads aloud", async () => {
  const view = await selected({ provider: null, model: null, providers: [] });
  expect(view.getByText("Read aloud")).toBeTruthy();
  expect(view.queryByRole("button", { name: /Translate/ })).toBeNull();
});
