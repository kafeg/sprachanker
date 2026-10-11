import { expect, test } from "bun:test";
import type { Exercise } from "@sprachanker/schema";
import { ItemCard, sharedPrompt } from "../../src/exercises/item-card.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const dictation = {
  key: "sprachanker.test/demo/00-01/ex-03",
  type: "dictation",
  fingerprint: "x",
  newWords: [],
  ruleIds: [],
  items: [
    {
      key: "sprachanker.test/demo/00-01/ex-03#1",
      prompt: "Hör zu",
      media: { audio: "media/audio/tag.mp3" },
      answer: { accepted: ["Guten Tag"] },
    },
  ],
} as unknown as Exercise;

const card = (outcome?: "wrong" | "correct") =>
  renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={dictation}
        locale={null}
        index={0}
        answer={{ text: "Gutten Tag" }}
        outcome={
          outcome && {
            result: outcome,
            score: outcome === "correct" ? 1 : 0,
          }
        }
        url={(p) => `/library/x/${p}`}
      />
    </TargetLang>,
  );

test("an item shows its prompt and, under a wrong answer, the right one", async () => {
  const wrong = await card("wrong");
  expect(wrong.getByText("Hör zu")).toBeTruthy();
  expect(wrong.getByText("Guten Tag")).toBeTruthy();
  expect(wrong.getByText(/Correct answer/)).toBeTruthy();
});

test("a dictation checked word by word shows the right words once, in its diff", async () => {
  const view = await renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={dictation}
        locale={null}
        index={0}
        answer={{ text: "Gutten Tag" }}
        outcome={{
          result: "wrong",
          score: 0,
          diff: [
            { op: "wrong", actual: "Gutten", expected: "Guten" },
            { op: "equal", expected: "Tag", actual: "Tag" },
          ],
        }}
        url={(p) => `/library/x/${p}`}
      />
    </TargetLang>,
  );
  expect(view.getByText("Gutten → Guten")).toBeTruthy();
  expect(view.queryByText(/Correct answer/)).toBeNull();
});

test("a prompt every item has alike is shown once above them, not in each card", () => {
  const items = (prompts: Array<string | undefined>) =>
    ({
      ...dictation,
      items: prompts.map((prompt) => ({ ...dictation.items[0], prompt })),
    }) as Exercise;
  expect(sharedPrompt(items(["Hör zu", "Hör zu"]), null)).toEqual({
    target: "Hör zu",
    learner: undefined,
  });
  expect(sharedPrompt(items(["Hör zu", "Schreib"]), null)).toBeUndefined();
  // One item, or none with a prompt: nothing to share.
  expect(sharedPrompt(items(["Hör zu"]), null)).toBeUndefined();
  expect(sharedPrompt(items([undefined, undefined]), null)).toBeUndefined();
  // The learner's language's prompts count too.
  const locale = {
    sourceId: "x",
    items: { "#1": { prompt: "Слушай" }, "#2": { prompt: "Слушай" } },
  };
  expect(sharedPrompt(items([undefined, undefined]), locale)).toEqual({
    target: undefined,
    learner: "Слушай",
  });
});

test("a right answer or one not checked yet shows no answer under it", async () => {
  const right = await card("correct");
  expect(right.queryByText(/Correct answer/)).toBeNull();
  right.unmount();
  const open = await card();
  expect(open.queryByText(/Correct answer/)).toBeNull();
});

test("options in the learner's language come from the locale file, without the target's lang", async () => {
  const choice = {
    key: "sprachanker.test/demo/00-01/ex-04",
    type: "single_choice",
    fingerprint: "x",
    newWords: [],
    ruleIds: [],
    items: [
      {
        key: "sprachanker.test/demo/00-01/ex-04#1",
        options: [{ id: "a" }, { id: "b", text: "Ja, gern." }],
        answer: { optionIds: ["a"] },
      },
    ],
  } as unknown as Exercise;
  const view = await renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={choice}
        locale={{
          sourceId: "x",
          items: { "#1": { prompt: "Лиза и Керстин…", options: { a: "хорошо знакомы." } } },
        }}
        index={0}
        answer={undefined}
        url={(p) => `/library/x/${p}`}
      />
    </TargetLang>,
  );
  expect(view.getByText("Лиза и Керстин…")).toBeTruthy();
  expect(view.getByText("хорошо знакомы.").getAttribute("lang")).toBeNull();
  expect(view.getByText("Ja, gern.").getAttribute("lang")).toBe("de");
});

test("a picture tile chosen among several keeps its ticked box filled", async () => {
  const pictures = {
    key: "sprachanker.test/demo/00-01/ex-06",
    type: "multi_choice",
    fingerprint: "x",
    newWords: [],
    ruleIds: [],
    items: [
      {
        key: "sprachanker.test/demo/00-01/ex-06#1",
        options: [
          { id: "a", media: { image: "media/image/a.jpg" } },
          { id: "b", media: { image: "media/image/b.jpg" } },
        ],
        answer: { optionIds: ["a"] },
      },
    ],
  } as unknown as Exercise;
  const view = await renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={pictures}
        locale={null}
        index={0}
        answer={{ optionIds: ["a"] }}
        url={(p) => p}
        onAnswer={() => undefined}
      />
    </TargetLang>,
  );
  const box = (pressed: string) =>
    view.container.querySelector(`button[aria-pressed="${pressed}"] > span[aria-hidden]`)
      ?.className ?? "";
  expect(box("true")).toContain("bg-primary");
  expect(box("true")).not.toContain("bg-card");
  expect(box("false")).toContain("bg-card");
});

test("a speaking item shows the question heard first, then the answer to say, marked", async () => {
  const speaking = {
    ...dictation,
    type: "speech_selfrate",
    items: [{ key: "sprachanker.test/demo/00-01/ex-03#1", text: "Wie geht's?" }],
  } as unknown as Exercise;
  const view = await renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={speaking}
        locale={{ items: { "#1": { prompt: "Mir geht's gut." } } } as never}
        index={0}
        answer={undefined}
        url={(p) => p}
      />
    </TargetLang>,
  );
  const cue = view.getByText("Wie geht's?");
  const said = view.getByText("Mir geht's gut.");
  expect(cue.compareDocumentPosition(said) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(said.previousSibling?.textContent).toBe("Your answer");
  view.unmount();
  // Without a cue the prompt is the task, above as any item's.
  const task = await renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={{ ...speaking, items: [{ key: "sprachanker.test/demo/00-01/ex-03#1" }] } as never}
        locale={{ items: { "#1": { prompt: "Frag nach dem Weg." } } } as never}
        index={0}
        answer={undefined}
        url={(p) => p}
      />
    </TargetLang>,
  );
  expect(task.queryByText("Your answer")).toBeNull();
  expect(task.getByText("Frag nach dem Weg.").className).toContain("font-semibold");
  task.unmount();
  // The item's own line (a role-play's, an answer's frame), no question: the line, then its hint.
  const line = await renderApp(
    <TargetLang value="de">
      <ItemCard
        exercise={
          {
            ...speaking,
            items: [{ key: "sprachanker.test/demo/00-01/ex-03#1", prompt: "Ja, … / Nein, …" }],
          } as never
        }
        locale={{ items: { "#1": { hintHtml: "<p>Tipp</p>" } } } as never}
        index={0}
        answer={undefined}
        url={(p) => p}
      />
    </TargetLang>,
  );
  const own = line.getByText("Ja, … / Nein, …");
  expect(own.previousSibling?.textContent).toBe("Your answer");
  expect(
    own.compareDocumentPosition(line.getByText("Tipp")) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
