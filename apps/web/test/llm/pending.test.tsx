import { expect, setSystemTime, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { DialogueStep } from "../../src/llm/dialogue.tsx";
import { GoingOverStep } from "../../src/llm/going-over.tsx";
import { PendingExchange } from "../../src/llm/parts.tsx";
import { UnderstandingStep } from "../../src/llm/understanding.tsx";
import { WritingTask } from "../../src/llm/writing.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
const llm: [unknown[], unknown] = [["llm"], { model: "test-model" }];

test("a Dialogue still being prepared on the server shows as preparing on a page opened again", async () => {
  const view = await renderApp(
    <TargetLang value="de">
      <DialogueStep {...ids} />
    </TargetLang>,
    { data: [llm, [["scenes", ids.lessonKey], { scenes: [], pending: { preparing: true } }]] },
  );
  const button = view.getByRole("button", { name: /Preparing…/ });
  expect(button.hasAttribute("disabled")).toBe(true);
  // The page polls while the server works: gone with it.
  view.unmount();
});

test("a text still being checked on the server keeps Check waiting on a page opened again", async () => {
  const view = await renderApp(
    <TargetLang value="de">
      <WritingTask {...ids} />
    </TargetLang>,
    {
      path: "/",
      data: [
        llm,
        [
          ["writing", ids.lessonKey, ids.edition],
          {
            task: {
              task: "writing_task",
              input: "",
              result: {
                situation: "Stell dich vor.",
                points: ["Name", "Land", "Sprachen"],
                words: 30,
              },
              model: "m",
              latencyMs: 1,
              id: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A70",
              runId: "01K7A0Z8ZQ4J1V2W3X4Y5Z6A71",
              itemKey: null,
              cardId: null,
              ts: 1,
            },
            words: [],
            attempts: [],
            checking: "Ich heiße Emma.",
            preparing: false,
          },
        ],
      ],
    },
  );
  const button = view.getByRole("button", { name: /Checking…/ });
  expect(button.hasAttribute("disabled")).toBe(true);
  view.unmount();
});

test("a reply not begun shows Thinking… with the seconds it takes (a CLI answers in one piece)", async () => {
  const view = await renderApp(<PendingExchange question="Wie geht's?" />);
  const thinking = view.getByText(/Thinking…/);
  expect(thinking.textContent?.trim()).toBe("Thinking…");
  try {
    setSystemTime(new Date(Date.now() + 12_000));
    await waitFor(() => expect(thinking.textContent).toContain("12 sec"), { timeout: 2500 });
  } finally {
    setSystemTime();
    view.unmount();
  }
});

test("a long wait says what is being done beside its seconds: the text's questions checked, new tasks made, a task set", async () => {
  const understanding = await renderApp(
    <TargetLang value="de">
      <UnderstandingStep {...ids} />
    </TargetLang>,
    {
      data: [
        llm,
        [["understanding", ids.lessonKey], { texts: [], preparing: true, step: "checking" }],
      ],
    },
  );
  expect(understanding.getByText(/Checking the questions…/)).toBeTruthy();
  understanding.unmount();
  const goingOver = await renderApp(
    <TargetLang value="de">
      <GoingOverStep {...ids} />
    </TargetLang>,
    {
      data: [
        llm,
        [["going-over", ids.lessonKey], { reviews: [], preparing: true, step: "making" }],
      ],
    },
  );
  expect(goingOver.getByText(/Making new tasks…/)).toBeTruthy();
  goingOver.unmount();
  const writing = await renderApp(
    <TargetLang value="de">
      <WritingTask {...ids} />
    </TargetLang>,
    {
      data: [
        llm,
        [
          ["writing", ids.lessonKey, ids.edition],
          { task: null, words: [], attempts: [], checking: null, preparing: true },
        ],
      ],
    },
  );
  expect(writing.getByText(/Setting a task…/)).toBeTruthy();
  writing.unmount();
});
