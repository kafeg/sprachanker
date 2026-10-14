// A course's AI practice on its page: how much of each step there is; made for every lesson — the
// steps (Listening only where Qwen3-TTS records it) and how many of each —; a job's progress and
// Stop; nothing to make without a model. A step's "more": how many, unavailable saying why.
import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { CoursePractice } from "../../src/llm/course-practice.tsx";
import { MoreButton } from "../../src/llm/practice-more.tsx";
import { renderApp } from "../render.tsx";

const WHAT = { series: "sprachanker.test", course: "demo", edition: "ru-de" };
const KEY = ["practice", WHAT.series, WHAT.course, WHAT.edition];
const llm: [unknown[], unknown] = [["llm"], { provider: "custom", model: "m" }];
const STATE = {
  lessons: 12,
  made: 3,
  variants: { reading: 3, listening: 2, writing: 3, speaking: 1 },
  voice: true,
  job: null,
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
      `${request.method} ${url.pathname} ${request.method === "POST" ? await request.text() : ""}`.trim(),
    );
    return Response.json(answer);
  }) as typeof fetch;
  return asked;
}

test("how much the course's lessons have; made for every lesson: the steps chosen, how many of each", async () => {
  const view = await renderApp(<CoursePractice {...WHAT} />, { data: [llm, [KEY, STATE]] });
  expect(view.getByText("3 of 12 lessons have practice.")).toBeTruthy();
  expect(view.getByText("Reading: 3 · Listening: 2 · Writing: 3 · Speaking: 1")).toBeTruthy();
  expect(view.getByText(/filled up to the number chosen/)).toBeTruthy();
  const asked = server({ ...STATE, job: null });
  fireEvent.click(view.getByRole("checkbox", { name: "Writing" }));
  fireEvent.click(view.getByRole("button", { name: "×2" }));
  fireEvent.click(view.getByRole("button", { name: "Make for every lesson" }));
  await waitFor(() => expect(asked[0]).toStartWith("POST /api/llm/practice "));
  expect(JSON.parse((asked[0] as string).replace("POST /api/llm/practice ", ""))).toEqual({
    ...WHAT,
    steps: ["reading", "listening", "speaking"],
    count: 2,
  });
  view.unmount();
});

test("a job running: its progress, the step being made, Stop; Listening off without Qwen3-TTS; nothing without a model", async () => {
  const job = {
    ...WHAT,
    steps: ["reading"],
    count: 1,
    total: 12,
    done: 4,
    current: [
      { lessonKey: "sprachanker.test/demo/01-05", step: "reading", count: 1 },
      { lessonKey: "sprachanker.test/demo/01-06", step: "reading", count: 1 },
    ],
    failed: [
      { lessonKey: "sprachanker.test/demo/01-02", step: "reading", count: 1, error: "llm_timeout" },
    ],
    state: "running",
    startedAt: 1,
    endedAt: null,
  };
  const running = await renderApp(<CoursePractice {...WHAT} />, {
    data: [llm, [KEY, { ...STATE, job }]],
  });
  expect(
    running.getByText("4 of 12 · lesson 01-05, Reading · lesson 01-06, Reading · 1 failed"),
  ).toBeTruthy();
  const asked = server({ ...job, state: "stopping" });
  fireEvent.click(running.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(asked[0]).toStartWith("POST /api/llm/practice/stop"));
  running.unmount();

  const deaf = await renderApp(<CoursePractice {...WHAT} />, {
    data: [
      [["llm"], { provider: "custom", model: null }],
      [KEY, { ...STATE, voice: false }],
    ],
  });
  expect((deaf.getByRole("checkbox", { name: "Listening" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(deaf.getByText(/recorded with Qwen3-TTS/)).toBeTruthy();
  expect(deaf.getByText(/needs an AI model/)).toBeTruthy();
  expect(
    (deaf.getByRole("button", { name: "Make for every lesson" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  deaf.unmount();
});

test("a step's more: how many, made; without a model or, to hear, Qwen3-TTS, why not", async () => {
  const made: number[] = [];
  const more = (needsVoice: boolean) => (
    <MoreButton
      label="New text"
      busyLabel="Writing…"
      preparing={false}
      edition="ru-de"
      needsVoice={needsVoice}
      onMake={(n) => made.push(n)}
    />
  );
  const view = await renderApp(more(false), { data: [llm] });
  fireEvent.click(view.getByRole("button", { name: "×3" }));
  fireEvent.click(view.getByRole("button", { name: "New text" }));
  expect(made).toEqual([3]);
  view.unmount();
  const deaf = await renderApp(more(true), {
    data: [llm, [["practice-voice", "ru-de"], { voice: false }]],
  });
  expect((deaf.getByRole("button", { name: "New text" }) as HTMLButtonElement).disabled).toBe(true);
  expect(deaf.getByText(/recorded with Qwen3-TTS/)).toBeTruthy();
  deaf.unmount();
});
