import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { DECK_EXAMPLES } from "../../src/api/cards.ts";
import {
  CardCorner,
  CardExamples,
  DeckExamplesRow,
  examplesAssistant,
} from "../../src/llm/word-examples.tsx";
import { StudyCard } from "../../src/study/card.tsx";
import { StudySlotsProvider } from "../../src/study/slots.ts";
import { TargetLang } from "../../src/ui/target-lang.ts";
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

test("a word's examples made for its deck, listed in its sheet: each with its translation, the words not met yet marked and translated", async () => {
  const view = await renderApp(<CardExamples cardId="c1" deck={scope} />, {
    data: [
      [["llm"], llm],
      [["card-examples", "c1", scope], made],
    ],
  });
  expect(view.getByText("heute").getAttribute("title")).toBe("сегодня");
  expect(view.getByText("Я сегодня пью кофе.")).toBeTruthy();
  expect(view.getByText("Der Kaffee ist heiß.")).toBeTruthy();
  expect(view.getByText("New here: heute — сегодня")).toBeTruthy();
  expect(view.getByText("Examples by the AI · gemma-4-12b")).toBeTruthy();
});

test("a card's corner: the way to its deck for what it has yet to make — its audio, its examples (none of its own, the AI working here)", async () => {
  const none = { scope, own: false, model: null, examples: [] };
  const corner = async (audio: boolean, shown: unknown, model: unknown = llm, settings = {}) => {
    const view = await renderApp(<CardCorner cardId="c1" scope={scope} audio={audio} />, {
      data: [
        [["llm"], model],
        [["settings"], settings],
        [["card-examples", "c1", scope], shown],
      ],
      path: "/review",
    });
    const text = view.container.textContent;
    const href = view.queryByRole("link")?.getAttribute("href");
    view.unmount();
    return [text, href];
  };
  const to = "/review/decks#deck-course-dw-nicos-weg-a1-ru";
  expect(await corner(false, none)).toEqual(["Make the deck's examples", to]);
  expect(await corner(true, none)).toEqual(["Read the deck aloud, make examples", to]);
  expect(await corner(true, { ...none, own: true })).toEqual(["Read the deck aloud", to]);
  expect(await corner(false, made)).toEqual(["", undefined]);
  // Without a model, or the place off: only what the deck's audio lacks.
  expect(await corner(true, none, { ...llm, model: null })).toEqual(["Read the deck aloud", to]);
  expect(await corner(false, none, llm, { "llm.offIn": ["example"] })).toEqual(["", undefined]);
  // A word's examples none: nothing in its sheet (the corner says it).
  const empty = await renderApp(<CardExamples cardId="c1" deck={scope} />, {
    data: [
      [["llm"], llm],
      [["card-examples", "c1", scope], none],
    ],
  });
  expect(empty.container.textContent).toBe("");
  empty.unmount();
  // Turned off: not shown, not asked for.
  const asked = server(made);
  const off = await renderApp(<CardExamples cardId="c2" deck={scope} />, {
    data: [
      [["llm"], llm],
      [["settings"], { "llm.offIn": ["example"] }],
    ],
  });
  expect(off.container.textContent).toBe("");
  expect(asked).toEqual([]);
});

test("a card's answer: no example at first; Example shows one, again the next — its own, then the AI's — round again; the question side has none", async () => {
  const display = {
    target: "der Kaffee",
    translation: "coffee",
    example: "Ich trinke Kaffee.",
    series: "dw.nicos-weg",
    lessonKey: "dw.nicos-weg/a1-ru/00-01",
  };
  const card = (side: "question" | "answer") =>
    renderApp(
      <TargetLang value="de">
        <StudySlotsProvider value={examplesAssistant}>
          <StudyCard cardId="c1" display={display} face="recognition" side={side} />
        </StudySlotsProvider>
      </TargetLang>,
      {
        path: "/review",
        data: [
          [["llm"], llm],
          // The examples of the deck whose entry the card shows.
          [["card-examples", "c1", scope], made],
        ],
      },
    );
  const answer = await card("answer");
  const example = () => answer.getByRole("button", { name: /^Example/ });
  await waitFor(() => expect(example()).toBeTruthy());
  expect(answer.queryByText("Ich trinke Kaffee.")).toBeNull();
  expect(answer.queryByText("Я сегодня пью кофе.")).toBeNull();
  fireEvent.click(example());
  expect(answer.getByText("Ich trinke Kaffee.").getAttribute("lang")).toBe("de");
  expect(example().textContent).toContain("1/3");
  fireEvent.click(example());
  // One at a time: the course's own gone (its text as a whole: the AI's has its words apart).
  expect(answer.container.textContent).not.toContain("Ich trinke Kaffee.");
  expect(answer.getByText("heute").getAttribute("title")).toBe("сегодня");
  expect(answer.getByText("Я сегодня пью кофе.")).toBeTruthy();
  expect(answer.getByText("New here: heute — сегодня")).toBeTruthy();
  expect(answer.getByText("Examples by the AI · gemma-4-12b")).toBeTruthy();
  expect(example().textContent).toContain("2/3");
  fireEvent.click(example());
  expect(answer.getByText("Der Kaffee ist heiß.")).toBeTruthy();
  fireEvent.click(example());
  expect(answer.getByText("Ich trinke Kaffee.")).toBeTruthy();
  expect(example().textContent).toContain("1/3");
  answer.unmount();
  const question = await card("question");
  expect(question.queryByRole("button", { name: /^Example/ })).toBeNull();
});

const deck = { words: 773, own: 0, made: 40, missing: 733, job: null };
const edition = "ru-de";
const key = [DECK_EXAMPLES, scope, edition];

test("a deck to take: its words with examples of all, and Make examples asks the server; its progress with Stop", async () => {
  const asked = server({
    ...deck,
    job: { status: "running", total: 733, done: 40, failed: 0, leftMs: 2 * 3600_000 },
  });
  const view = await renderApp(<DeckExamplesRow scope={scope} edition={edition} />, {
    data: [
      [["llm"], llm],
      [key, deck],
    ],
  });
  expect(view.getByText("Examples: 40 of 773")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Make examples" }));
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe(
      "Writing examples 40 of 733… · about 2 hours left",
    ),
  );
  expect(asked).toEqual([`POST /api/decks/examples {"scope":"${scope}","edition":"ru-de"}`]);
  fireEvent.click(view.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(asked).toHaveLength(2));
  expect(asked[1]).toBe(
    `DELETE /api/decks/examples?scope=${encodeURIComponent(scope)}&edition=ru-de`,
  );
});

test("the examples made removed or made again, each asked first", async () => {
  const asked = server({ ...deck, made: 0, missing: 773 });
  const view = await renderApp(
    <DeckExamplesRow scope={scope} edition={edition} title="Nicos Weg A1" />,
    {
      data: [
        [["llm"], llm],
        [key, deck],
      ],
    },
  );
  fireEvent.click(view.getByRole("button", { name: "Remove examples" }));
  expect(view.getByText("Remove the examples made for Nicos Weg A1?")).toBeTruthy();
  expect(asked).toEqual([]);
  fireEvent.click(view.getAllByRole("button", { name: "Remove examples" }).at(-1) as HTMLElement);
  await waitFor(() =>
    expect(asked).toEqual([
      `POST /api/decks/examples/remove {"scope":"${scope}","edition":"ru-de"}`,
    ]),
  );
  // Nothing made now: neither button.
  await waitFor(() => expect(view.queryByRole("button", { name: "Regenerate" })).toBeNull());
  view.unmount();
  const again = server(deck);
  const view2 = await renderApp(<DeckExamplesRow scope={scope} edition={edition} title="A1" />, {
    data: [
      [["llm"], llm],
      [key, deck],
    ],
  });
  fireEvent.click(view2.getByRole("button", { name: "Regenerate" }));
  expect(view2.getByText("Make the examples of A1 again?")).toBeTruthy();
  fireEvent.click(view2.getAllByRole("button", { name: "Regenerate" }).at(-1) as HTMLElement);
  await waitFor(() =>
    expect(again).toEqual([
      `POST /api/decks/examples {"scope":"${scope}","edition":"ru-de","again":true}`,
    ]),
  );
});

test("a deck taken: how its examples stand, in a line", async () => {
  const line = async (state: unknown) => {
    const view = await renderApp(<DeckExamplesRow scope={scope} edition={edition} status />, {
      data: [
        [["llm"], llm],
        [key, state],
      ],
    });
    const text = view.container.textContent;
    view.unmount();
    return text;
  };
  expect(await line(deck)).toBe("733 words without examples");
  expect(await line({ ...deck, made: 773, missing: 0 })).toBe("All words have examples");
  expect(await line({ ...deck, own: 773, made: 0, missing: 0 })).toBe("");
  expect(await line({ ...deck, job: { status: "running", total: 733, done: 40, failed: 0 } })).toBe(
    "Writing examples 40 of 733…",
  );
});

test("a deck's examples: without a model where to set one up; all made, nothing to make; words that failed said with why", async () => {
  const noModel = await renderApp(<DeckExamplesRow scope={scope} edition={edition} />, {
    data: [
      [["llm"], { ...llm, model: null }],
      [key, deck],
    ],
    path: "/review/decks",
  });
  expect(noModel.queryByRole("button", { name: "Make examples" })).toBeNull();
  expect(
    noModel
      .getByRole("link", { name: "To make examples, set up the AI assistant in Settings" })
      .getAttribute("href"),
  ).toBe("/settings#ai");
  // What was made can still be removed.
  expect(noModel.getByRole("button", { name: "Remove examples" })).toBeTruthy();
  noModel.unmount();
  const all = await renderApp(<DeckExamplesRow scope={scope} edition={edition} />, {
    data: [
      [["llm"], llm],
      [key, { ...deck, made: 773, missing: 0 }],
    ],
  });
  expect(all.getByText("Examples: 773 of 773")).toBeTruthy();
  expect(all.queryByRole("button", { name: "Make examples" })).toBeNull();
  all.unmount();
  const failed = await renderApp(<DeckExamplesRow scope={scope} edition={edition} />, {
    data: [
      [["llm"], llm],
      [
        key,
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
