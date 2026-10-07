import { expect, test } from "bun:test";
import { SceneStep } from "../../src/llm/scene.tsx";
import { WritingTask } from "../../src/llm/writing.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { lesson } from "../lesson/lesson.ts";
import { renderApp } from "../render.tsx";

const ids = { series: "sprachanker.test", lessonKey: lesson.key, edition: "en-de" };
const llm: [unknown[], unknown] = [["llm"], { model: "test-model" }];

test("a scene still being prepared on the server shows as preparing on a page opened again", async () => {
  const view = await renderApp(
    <TargetLang value="de">
      <SceneStep {...ids} />
    </TargetLang>,
    { data: [llm, [["scenes", ids.lessonKey], { scenes: [], pending: { preparing: true } }]] },
  );
  const button = view.getByRole("button", { name: /Preparing…/ });
  expect(button.hasAttribute("disabled")).toBe(true);
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
});
