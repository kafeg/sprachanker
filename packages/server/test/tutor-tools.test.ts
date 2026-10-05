import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-02";

test("tutor tools: the model looks a word up, the reply carries what it used", async () => {
  const bodies: Array<{ messages: Array<{ role: string; content: string }>; tools?: unknown[] }> =
    [];
  const sse = (...events: unknown[]) =>
    new Response(`${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`);
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    bodies.push(JSON.parse(init.body as string));
    if (bodies.length === 1)
      return sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c1",
                  function: { name: "find_word", arguments: '{"word":"Kaffee"}' },
                },
              ],
            },
          },
        ],
      });
    return sse({ choices: [{ delta: { content: "In Lektion 0.1." } }] });
  }) as unknown as typeof globalThis.fetch;
  const { send, getJson } = await setup({ fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });

  const res = await send("POST", "/api/llm/tutor", {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
    message: "Wo war Kaffee?",
    language: "ru",
  });
  expect(await res.text()).toBe("In Lektion 0.1.");
  expect(bodies[0]?.tools).toHaveLength(4);
  const result = JSON.parse(bodies[1]?.messages.at(-1)?.content ?? "{}");
  expect(result.found[0]).toMatchObject({ word: "der Kaffee, die Kaffees", translation: "кофе" });
  expect(result.found[0].lesson).toMatch(/^0\.1 /);

  const { turns } = await getJson(`/api/llm/tutor?lessonKey=${LESSON}`);
  expect(turns[1].tools).toEqual([{ name: "find_word", args: { word: "Kaffee" } }]);
});

test("tutor tools: progress, lessons by number or title, mistakes", async () => {
  // The runner is exercised through the prompt-free path: call the tools via a model that asks for each.
  const asked = [
    ["get_lesson", { lesson: "0.2" }],
    ["get_lesson", { lesson: "nope" }],
    ["get_progress", {}],
    ["get_mistakes", {}],
  ] as const;
  const results: unknown[] = [];
  let round = 0;
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const body = JSON.parse(init.body as string);
    const last = body.messages.at(-1);
    if (last.role === "tool") results.push(JSON.parse(last.content));
    const next = asked[round++];
    const event = next
      ? {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `c${round}`,
                    function: { name: next[0], arguments: JSON.stringify(next[1]) },
                  },
                ],
              },
            },
          ],
        }
      : { choices: [{ delta: { content: "ok" } }] };
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
  }) as unknown as typeof globalThis.fetch;
  const { send } = await setup({ fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  await (
    await send("POST", "/api/llm/tutor", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
      message: "?",
      language: "ru",
    })
  ).text();
  // Four rounds at most: three tool rounds, then the answer.
  expect(results).toHaveLength(3);
  expect(results[0]).toMatchObject({ lesson: expect.stringMatching(/^0\.2 /) });
  expect((results[0] as { words: string }).words.length).toBeGreaterThan(0);
  expect(results[1]).toEqual({ error: 'no lesson "nope"' });
  expect(results[2]).toMatchObject({
    lessons: 2,
    done: 0,
    current: expect.stringMatching(/^0\.2/),
  });
});
