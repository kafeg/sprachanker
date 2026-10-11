import { expect, setSystemTime, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { DialogueStep } from "../../src/llm/dialogue.tsx";
import { PendingExchange } from "../../src/llm/parts.tsx";
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
          { topic: ["Stell dich vor."], words: [], attempts: [], checking: "Ich heiße Emma." },
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
