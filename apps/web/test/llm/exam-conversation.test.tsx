// A speaking part held with the assistant (09, Exams): the learner's own lines are the answer — none
// while only the examiner has spoken, the same lines not stored again —, "End the part" kept once and
// shown ended.
import { afterEach, expect, test } from "bun:test";
import type { TypedEvent } from "@sprachanker/schema";
import { fireEvent, waitFor } from "@testing-library/react";
import { ExamConversation } from "../../src/llm/exam-conversation.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const ITEM = "goethe.zertifikat/a1/exam-modellsatz/q-sprechen-1";
let n = 0;
const turn = (payload: Record<string, unknown>): TypedEvent =>
  ({ id: `T${++n}`, runId: "R", ts: n, type: "llm_turn", itemKey: ITEM, payload }) as TypedEvent;
const greeting = turn({ role: "assistant", speaker: "examiner", text: "Guten Tag!" });
const mine = turn({ role: "user", text: "Ich heiße Anna." });
const answered = (text: string): TypedEvent =>
  ({
    id: `A${++n}`,
    runId: "R",
    ts: n,
    type: "answered",
    itemKey: ITEM,
    payload: { answer: { text }, attempt: 1, ms: 1 },
  }) as TypedEvent;

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

const render = (events: TypedEvent[], answers: Array<[string, boolean]>, stored: unknown[] = []) =>
  renderApp(
    <TargetLang value="de">
      <ExamConversation
        runId="R"
        itemKey={ITEM}
        events={events}
        onStored={(kept) => stored.push(...kept)}
        onAnswer={(text, final) => answers.push([text, final])}
      />
    </TargetLang>,
    { data: [[["llm"], { provider: "custom", model: "m", providers: [] }]] },
  );

test("ending the part: kept once, the learner's own lines the answer, stored only when changed", async () => {
  const ended = turn({ role: "user", text: "", done: true });
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push(await request.text());
    return Response.json({ events: [ended], done: true });
  }) as typeof fetch;

  // Answered as it went (a mock exam): ending stores nothing new.
  const answers: Array<[string, boolean]> = [];
  const stored: unknown[] = [];
  const view = await render([greeting, mine, answered("Ich heiße Anna.")], answers, stored);
  fireEvent.click(view.getByRole("button", { name: "End the part" }));
  await waitFor(() => expect(stored).toEqual([ended]));
  expect(JSON.parse(asked[0] ?? "{}")).toMatchObject({ runId: "R", itemKey: ITEM, end: true });
  expect(answers).toEqual([]);
  view.unmount();

  // Not stored yet (practice): the learner's lines, without the examiner's or any label.
  const practice: Array<[string, boolean]> = [];
  const again = await render([greeting, mine], practice);
  fireEvent.click(again.getByRole("button", { name: "End the part" }));
  await waitFor(() => expect(practice).toEqual([["Ich heiße Anna.", true]]));
});

test("a part ended shows ended: no composer, no End; only the examiner greeting answers nothing", async () => {
  const answers: Array<[string, boolean]> = [];
  const ended = turn({ role: "user", text: "", done: true });
  const view = await render([greeting, mine, ended], answers);
  expect(view.getByText("The part is over.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "End the part" })).toBeNull();
  expect(view.queryByRole("textbox")).toBeNull();
  expect(view.getByText("Ich heiße Anna.")).toBeTruthy();
  view.unmount();

  // Only the examiner has spoken: ending stores no answer.
  const stored: unknown[] = [];
  globalThis.fetch = (async () =>
    Response.json({ events: [ended], done: true })) as unknown as typeof fetch;
  const open = await render([greeting], answers, stored);
  fireEvent.click(open.getByRole("button", { name: "End the part" }));
  await waitFor(() => expect(stored).toEqual([ended]));
  expect(answers).toEqual([]);
});
