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
    leftMs: 9 * 60_000,
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

test("a deck to take: its words with audio of all, and Generate audio asks the server to read them", async () => {
  const asked = server(running);
  const view = await renderApp(<DeckAudio scope={scope} />, {
    data: [[["deck-audio", scope], state]],
    path: "/review/decks",
  });
  expect(view.getByText("Audio: 30 of 774")).toBeTruthy();
  // Who reads them, and where another voice is chosen.
  expect(view.getByText(/^Read by Piper · thorsten \(German\)/)).toBeTruthy();
  expect(view.getByRole("link", { name: "Choose a voice" }).getAttribute("href")).toBe(
    "/settings#speech",
  );
  fireEvent.click(view.getByRole("button", { name: "Generate audio" }));
  // While it reads: its progress, about how long the rest takes, and Stop.
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe("Reading 120 of 744… · about 9 minutes left"),
  );
  expect(asked).toEqual([`POST /api/decks/audio {"scope":"${scope}"}`]);
  expect(view.queryByRole("button", { name: "Remove generated audio" })).toBeNull();
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
    name: "To generate it, install a voice for German in Settings → Speech",
  });
  expect(link.getAttribute("href")).toBe("/settings#speech");
});

test("a deck taken: how its audio stands, in a line — a quiet one once all were read, none when all are the deck's own", async () => {
  const line = async (shown: unknown) => {
    const view = await renderApp(<DeckAudio scope={scope} status />, {
      data: [[["deck-audio", scope], shown]],
    });
    const text = view.container.textContent;
    view.unmount();
    return text;
  };
  expect(await line(state)).toBe("744 words without audio");
  expect(await line({ ...state, read: 774, missing: 0 })).toBe("All words have audio");
  expect(await line({ ...state, own: 774, read: 0, missing: 0 })).toBe("");
  expect(await line(running)).toBe("Reading 120 of 744…");
});

test("the audio generated removed or generated again, each asked first; words that failed said", async () => {
  const asked = server({ ...state, read: 0, missing: 774 });
  const view = await renderApp(<DeckAudio scope={scope} title="Deutsch A1" />, {
    data: [[["deck-audio", scope], state]],
    path: "/review/decks",
  });
  fireEvent.click(view.getByRole("button", { name: "Remove generated audio" }));
  expect(view.getByText("Remove the audio generated for Deutsch A1?")).toBeTruthy();
  expect(asked).toEqual([]);
  fireEvent.click(
    view.getAllByRole("button", { name: "Remove generated audio" }).at(-1) as HTMLElement,
  );
  await waitFor(() => expect(asked).toEqual([`POST /api/decks/audio/remove {"scope":"${scope}"}`]));
  await waitFor(() => expect(view.getByText("Audio: 0 of 774")).toBeTruthy());
  expect(view.queryByRole("button", { name: "Regenerate" })).toBeNull();
  view.unmount();
  const again = server(running);
  const view2 = await renderApp(<DeckAudio scope={scope} title="Deutsch A1" />, {
    data: [[["deck-audio", scope], state]],
    path: "/review/decks",
  });
  fireEvent.click(view2.getByRole("button", { name: "Regenerate" }));
  expect(view2.getByText("Generate the audio of Deutsch A1 again?")).toBeTruthy();
  fireEvent.click(view2.getAllByRole("button", { name: "Regenerate" }).at(-1) as HTMLElement);
  await waitFor(() =>
    expect(again).toEqual([`POST /api/decks/audio {"scope":"${scope}","again":true}`]),
  );
  view2.unmount();
  const failed = await renderApp(<DeckAudio scope={scope} />, {
    data: [
      [
        ["deck-audio", scope],
        {
          ...state,
          read: 771,
          missing: 3,
          job: {
            status: "failed",
            engine: "piper",
            total: 744,
            done: 741,
            failed: 3,
            error: "speech_unavailable",
          },
        },
      ],
    ],
    path: "/review/decks",
  });
  // How many, and why.
  expect(failed.getByText(/^3 words could not be read aloud Reason: /)).toBeTruthy();
  expect(failed.getByRole("button", { name: "Generate audio" })).toBeTruthy();
});
