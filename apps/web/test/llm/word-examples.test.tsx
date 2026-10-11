import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { CardExamples, DeckExamplesRow } from "../../src/llm/word-examples.tsx";
import { StudyCard } from "../../src/study/card.tsx";
import { StudySlotsProvider } from "../../src/study/slots.ts";
import { renderApp } from "../render.tsx";

const llm = { provider: "custom", model: "m", providers: [] };
const scope = "course:dw.nicos-weg/a1-ru";
const made = {
  scope,
  own: false,
  model: "google/gemma-4-12b",
  examples: [
    {
      sentence: "Ich trinke heute Kaffee.",
      translation: "Я сегодня пью кофе.",
      words: [
        { text: "Ich trinke " },
        { text: "heute", new: true, translation: "сегодня" },
        { text: " Kaffee." },
      ],
    },
    {
      sentence: "Der Kaffee ist heiß.",
      translation: "Кофе горячий.",
      words: [{ text: "Der Kaffee ist heiß." }],
    },
  ],
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

test("a card's examples made for its deck: each with its translation, the words not met yet marked and translated, read aloud on request", async () => {
  const view = await renderApp(<CardExamples cardId="c1" />, {
    data: [
      [["llm"], llm],
      [["card-examples", "c1"], made],
    ],
  });
  expect(view.getByText("heute").getAttribute("title")).toBe("сегодня");
  expect(view.getByText("Я сегодня пью кофе.")).toBeTruthy();
  expect(view.getByText("Der Kaffee ist heiß.")).toBeTruthy();
  expect(view.getByText("New here: heute — сегодня")).toBeTruthy();
  expect(view.getByText("Examples by the AI · gemma-4-12b")).toBeTruthy();
});

test("a card whose deck has none for it: the way to Decks while the AI works here; nothing when its word has its own, or the place is off", async () => {
  const none = await renderApp(<CardExamples cardId="c1" />, {
    data: [
      [["llm"], llm],
      [["card-examples", "c1"], { scope, own: false, model: null, examples: [] }],
    ],
    path: "/review",
  });
  expect(none.getByText(/No examples for this word yet/)).toBeTruthy();
  expect(
    none.getByRole("link", { name: "Make them for its deck in Decks" }).getAttribute("href"),
  ).toBe("/review/decks");
  none.unmount();
  const own = await renderApp(<CardExamples cardId="c1" />, {
    data: [
      [["llm"], llm],
      [["card-examples", "c1"], { scope, own: true, model: null, examples: [] }],
    ],
  });
  expect(own.container.textContent).toBe("");
  own.unmount();
  const noModel = await renderApp(<CardExamples cardId="c1" />, {
    data: [
      [["llm"], { ...llm, model: null }],
      [["card-examples", "c1"], { scope, own: false, model: null, examples: [] }],
    ],
  });
  expect(noModel.container.textContent).toBe("");
  noModel.unmount();
  // Turned off: not shown, not asked for.
  const asked = server(made);
  const off = await renderApp(<CardExamples cardId="c2" />, {
    data: [
      [["llm"], llm],
      [["settings"], { "llm.offIn": ["example"] }],
    ],
  });
  expect(off.container.textContent).toBe("");
  expect(asked).toEqual([]);
});

test("the card's answer side shows what the slot adds, the question side does not", async () => {
  const display = {
    target: "der Kaffee",
    translation: "coffee",
    series: "s",
    lessonKey: "s/c/00-01",
  };
  const card = (side: "question" | "answer") =>
    renderApp(
      <StudySlotsProvider value={{ word: ({ cardId }) => <span>extra {cardId}</span> }}>
        <StudyCard cardId="c1" display={display} face="recognition" side={side} />
      </StudySlotsProvider>,
      { path: "/review" },
    );
  const answer = await card("answer");
  expect(answer.getByText("extra c1")).toBeTruthy();
  answer.unmount();
  expect((await card("question")).queryByText("extra c1")).toBeNull();
});

const deck = { words: 773, own: 0, made: 40, missing: 733, job: null };

test("a deck's words without examples: how many, and Make examples asks the server; its progress with Stop", async () => {
  const asked = server({
    ...deck,
    job: { status: "running", total: 733, done: 40, failed: 0, leftMs: 2 * 3600_000 },
  });
  const view = await renderApp(<DeckExamplesRow scope={scope} />, {
    data: [
      [["llm"], llm],
      [["deck-examples", scope], deck],
    ],
  });
  expect(view.getByText("733 words without examples")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Make examples" }));
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe(
      "Writing examples 40 of 733… · about 2 hours left",
    ),
  );
  expect(asked).toEqual([`POST /api/decks/examples {"scope":"${scope}"}`]);
  fireEvent.click(view.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(asked).toHaveLength(2));
  expect(asked[1]).toBe(`DELETE /api/decks/examples?scope=${encodeURIComponent(scope)}`);
});

test("a deck's examples: without a model where to set one up; all made a quiet line; words that failed said with why", async () => {
  const noModel = await renderApp(<DeckExamplesRow scope={scope} />, {
    data: [
      [["llm"], { ...llm, model: null }],
      [["deck-examples", scope], deck],
    ],
    path: "/review/decks",
  });
  expect(noModel.queryByRole("button", { name: "Make examples" })).toBeNull();
  expect(
    noModel
      .getByRole("link", { name: "To make examples, set up the AI assistant in Settings" })
      .getAttribute("href"),
  ).toBe("/settings#ai");
  noModel.unmount();
  const all = await renderApp(<DeckExamplesRow scope={scope} />, {
    data: [
      [["llm"], llm],
      [["deck-examples", scope], { ...deck, made: 773, missing: 0 }],
    ],
  });
  expect(all.getByText("All words have examples")).toBeTruthy();
  all.unmount();
  const failed = await renderApp(<DeckExamplesRow scope={scope} />, {
    data: [
      [["llm"], llm],
      [
        ["deck-examples", scope],
        {
          ...deck,
          job: { status: "failed", total: 733, done: 0, failed: 15, error: "llm_unreachable" },
        },
      ],
    ],
  });
  expect(failed.getByText(/^15 words got no examples Reason: /)).toBeTruthy();
  expect(failed.getByRole("button", { name: "Make examples" })).toBeTruthy();
});
