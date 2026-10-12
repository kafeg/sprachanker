import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const CAFE = "sprachanker.fixture/demo/00-01";
const SPEAKING = "sprachanker.fixture/demo/00-02";

test("mistakes reach the tutor: fixed ones marked, redone lessons count afresh", async () => {
  const { send, sendJson } = await setup();
  const answer = async (runId: string, item: string, value: unknown, attempt = 1) =>
    sendJson("POST", `/api/runs/${runId}/events`, {
      events: [
        {
          id: ulid(),
          type: "answered",
          itemKey: item,
          payload: { answer: value, attempt, ms: 100 },
        },
      ],
    });
  const start = async (restart = false) =>
    (
      await sendJson("POST", "/api/runs", {
        series: FIXTURE_SERIES,
        lessonKey: CAFE,
        edition: "ru-de",
        restart,
      })
    ).run.id as string;
  const prompt = async (lessonKey: string) => {
    const preview = await sendJson("POST", "/api/llm/tutor/prompt", {
      series: FIXTURE_SERIES,
      lessonKey,
      edition: "ru-de",
      message: "",
      language: "ru",
    });
    return preview.body.messages[0].content as string;
  };
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });

  const run = await start();
  await answer(run, `${CAFE}/ex-06#1`, { g1: "a" }); // Herr instead of Frau
  await answer(run, `${CAFE}/ex-06#1`, { g1: "b" }, 2); // fixed
  await answer(run, `${CAFE}/ex-01#1`, { optionId: "b" }); // wrong, not fixed
  await answer(run, `${CAFE}/ex-01#2`, { optionId: "b" }); // right

  const here = await prompt(CAFE);
  expect(here).toContain("In this lesson:");
  // Only what was wrong in each: the gap with its words around it, the option chosen.
  expect(here).toMatch(
    /item 1\] \(fixed later\)\n {2}learner "Herr", correct "Frau" in "Guten Tag, ___ Weber."/,
  );
  expect(here).toContain('learner "Im Park.", correct "Im Café." to "Wo ist Lena?"');
  expect(here).not.toContain("In earlier lessons:");

  // From the next lesson they are earlier mistakes, with the lesson's title.
  expect(await prompt(SPEAKING)).toMatch(/In earlier lessons:\n- \[.+\]/);

  // The lesson done again, this time right: no longer a mistake.
  const again = await start(true);
  await answer(again, `${CAFE}/ex-01#1`, { optionId: "a" });
  expect(await prompt(CAFE)).not.toContain("Im Park.");
});
