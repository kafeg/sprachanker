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

test("with a model the bar has one action, Translate: the card shown at once, kept in Finds; its audio made after (a spinner), then played by itself", async () => {
  let made: (audio: string) => void = () => {};
  const audio = new Promise<string>((resolve) => {
    made = resolve;
  });
  const asked = server(async (path) =>
    path === "/api/llm/finds"
      ? {
          target: "die Situation",
          translation: "ситуация",
          from: "target",
          lang: "de",
          audio: null,
          word: { deck: "finds-local-ru-de", key: "k1" },
          added: true,
        }
      : path === "/api/llm/finds/audio"
        ? { audio: await audio }
        : {},
  );
  const played: string[] = [];
  const realAudio = globalThis.Audio;
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
    const view = await selected(llm);
    // One action: Translate reads the language learnt aloud itself.
    expect(view.queryByText("Read aloud")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: /Translate/ }));
    // The translation as soon as the model answered, its audio still being made.
    await view.findByText("Added to Finds", {}, { timeout: 10_000 });
    expect(view.getByText("die Situation").getAttribute("lang")).toBe("de");
    expect(view.getByText(/— ситуация/)).toBeTruthy();
    // The audio asked for right after the card is shown: waited for, not assumed (a loaded machine).
    await view.findByRole("status", { name: "Audio being made" }, { timeout: 10_000 });
    await waitFor(() => expect(asked).toHaveLength(2), { timeout: 10_000 });
    expect(asked).toEqual([
      `POST /api/llm/finds ${JSON.stringify({
        text: "Situation",
        context: "Das ist eine schwierige Situation.",
        lang: "de",
      })}`,
      `POST /api/llm/finds/audio ${JSON.stringify({ deck: "finds-local-ru-de", key: "k1" })}`,
    ]);
    // Made: played once, by itself; the play button says it again.
    made("/decks/finds-local-ru-de/media/find-1.wav");
    await waitFor(() => expect(played).toHaveLength(1), { timeout: 10_000 });
    expect(asked).toContain("GET /decks/finds-local-ru-de/media/find-1.wav");
    expect(said).toEqual([]);
    await waitFor(
      () => expect(view.queryByRole("status", { name: "Audio being made" })).toBeNull(),
      { timeout: 10_000 },
    );
    fireEvent.click(view.getByRole("button", { name: "Listen" }));
    await waitFor(() => expect(played).toHaveLength(2), { timeout: 10_000 });
  } finally {
    (globalThis as { Audio: unknown }).Audio = realAudio;
  }
}, 30_000);

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
