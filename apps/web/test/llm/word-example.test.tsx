import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { WordExample } from "../../src/llm/word-example.tsx";
import { StudyCard } from "../../src/study/card.tsx";
import { StudySlotsProvider } from "../../src/study/slots.ts";
import { renderApp } from "../render.tsx";

const llm = { provider: "custom", model: "m", providers: [] };
const kept = {
  examples: [
    {
      ts: 2,
      model: "google/gemma",
      sentence: "Hier ist der Kaffee heute.",
      translation: "Here it is today.",
      words: [
        { text: "Hier ist der Kaffee " },
        { text: "heute", new: true, translation: "today" },
        { text: "." },
      ],
    },
  ],
};

test("an example only on request: the newest kept, its new words marked and translated", async () => {
  const view = await renderApp(<WordExample cardId="c1" />, {
    data: [
      [["llm"], llm],
      [["examples", "c1"], kept],
    ],
  });
  expect(view.queryByText(/Hier ist/)).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Example" }));
  expect((await view.findByText("heute")).getAttribute("title")).toBe("today");
  expect(view.getByText("Here it is today.")).toBeTruthy();
  expect(view.getByText(/heute — today/)).toBeTruthy();
  expect(view.getByText(/gemma/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Another example" })).toBeTruthy();
});

test("without a model and nothing kept: where to set one up", async () => {
  const view = await renderApp(<WordExample cardId="c1" />, {
    data: [
      [["llm"], { ...llm, model: null }],
      [["examples", "c1"], { examples: [] }],
    ],
  });
  fireEvent.click(view.getByRole("button", { name: "Example" }));
  expect(await view.findByText(/Set up the AI assistant/)).toBeTruthy();
});

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

test("the card's answer side shows what the slot adds", async () => {
  expect((await card("answer")).getByText("extra c1")).toBeTruthy();
});

test("the card's question side does not", async () => {
  const view = await card("question");
  expect(view.getByText("der Kaffee")).toBeTruthy();
  expect(view.queryByText("extra c1")).toBeNull();
});
