import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { DeckAudio } from "../../src/study/deck-audio.tsx";
import { renderApp } from "../render.tsx";

const scope = "deck:a1-abc123";
const state = {
  lang: "de",
  words: 774,
  own: 0,
  read: 30,
  missing: 744,
  reader: { engine: "piper" as const, voice: "de_DE-thorsten-medium" },
  job: null,
};
const running = {
  ...state,
  job: {
    status: "running",
    engine: "piper",
    total: 744,
    done: 120,
    failed: 0,
    current: "der Abend",
  },
};

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

/** The server on paper: what it was asked, answering with `answer`. */
function server(answer: unknown) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(
      `${request.method} ${url.pathname}${url.search} ${request.method === "POST" ? await request.text() : ""}`.trim(),
    );
    return Response.json(answer);
  }) as typeof fetch;
  return asked;
}

test("a deck's words without audio: how many, and Generate audio asks the server to read them", async () => {
  const asked = server(running);
  const view = await renderApp(<DeckAudio scope={scope} />, {
    data: [[["deck-audio", scope], state]],
  });
  expect(view.getByText("744 words without audio")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Generate audio" }));
  // While it reads: its progress and Stop.
  await waitFor(() => expect(view.getByRole("status").textContent).toBe("Reading 120 of 744…"));
  expect(asked).toEqual([`POST /api/decks/audio {"scope":"${scope}"}`]);
  expect(view.queryByRole("button", { name: "Generate audio" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(asked).toHaveLength(2));
  expect(asked[1]).toBe(`DELETE /api/decks/audio?scope=${encodeURIComponent(scope)}`);
});

test("nothing here reads the words' language: where to install a voice instead of the button", async () => {
  const view = await renderApp(<DeckAudio scope={scope} />, {
    data: [[["deck-audio", scope], { ...state, reader: null }]],
    path: "/review/decks",
  });
  expect(view.queryByRole("button", { name: "Generate audio" })).toBeNull();
  const link = view.getByRole("link", {
    name: "To make it, install a voice for German in Settings → Speech",
  });
  expect(link.getAttribute("href")).toBe("/settings#speech");
});

test("every word with audio: a quiet line once some were read, nothing when all are the deck's own; words that failed said", async () => {
  const all = await renderApp(<DeckAudio scope={scope} />, {
    data: [[["deck-audio", scope], { ...state, read: 774, missing: 0 }]],
  });
  expect(all.getByText("All words have audio")).toBeTruthy();
  all.unmount();
  const own = await renderApp(<DeckAudio scope={scope} />, {
    data: [[["deck-audio", scope], { ...state, own: 774, read: 0, missing: 0 }]],
  });
  expect(own.container.textContent).toBe("");
  own.unmount();
  const failed = await renderApp(<DeckAudio scope={scope} />, {
    data: [
      [
        ["deck-audio", scope],
        {
          ...state,
          read: 771,
          missing: 3,
          job: { status: "failed", engine: "piper", total: 744, done: 741, failed: 3 },
        },
      ],
    ],
  });
  expect(failed.getByText("3 words could not be read aloud")).toBeTruthy();
  expect(failed.getByRole("button", { name: "Generate audio" })).toBeTruthy();
});
