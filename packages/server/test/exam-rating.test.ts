// An exam's open answer rated by the assistant: proposed only once a mock exam is handed in, kept on
// the question in the run (asked once per answer), scoring nothing until the learner takes it.
import { expect, test } from "bun:test";
import { MODELL } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const m = (id: string) => `${MODELL}/q-${id}`;
const PROPOSAL = {
  criteria: [
    { id: "wann", points: 3, reason: "Um drei." },
    { id: "was", points: 1.5, reason: "Kuchen, but not for whom." },
    { id: "form", points: 1, reason: "Lieber Tom … Bis bald!" },
  ],
  feedback: "Say who the cake is for.",
};

/** A model answering structured requests: first a level the criterion lacks, then the proposal. */
function model() {
  const bodies: Array<{ messages: Array<{ content: string }> }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    bodies.push(JSON.parse(init.body as string));
    const reply =
      bodies.length === 1
        ? {
            ...PROPOSAL,
            criteria: [{ ...PROPOSAL.criteria[0], points: 2 }, ...PROPOSAL.criteria.slice(1)],
          }
        : PROPOSAL;
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

test("a proposal for a handed-in mock exam's note: kept on the question, asked once, taken as a rating", async () => {
  const ai = model();
  const api = await setup({ fetch: ai.fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const { run } = await api.sendJson("POST", "/api/exams/runs", {
    exam: MODELL,
    edition: "en-de",
    mode: "test",
    module: "schreiben",
  });
  const note = "Lieber Tom, ich komme um drei und bringe Kuchen mit. Bis bald!";
  await api.sendJson("POST", `/api/exams/runs/${run.id}/events`, {
    events: [
      {
        id: ulid(),
        type: "answered",
        itemKey: m("s3"),
        payload: { answer: { text: note }, attempt: 1, ms: 1 },
      },
    ],
  });
  const body = { runId: run.id, itemKey: m("s3"), language: "ru" };
  // While the mock exam runs, the assistant does not help.
  const early = await api.send("POST", "/api/llm/exam-rating", body);
  expect([early.status, await early.text()]).toEqual([409, '{"error":"exam_test_running"}']);
  expect(ai.bodies).toHaveLength(0);
  await api.sendJson("POST", `/api/exams/runs/${run.id}/finish`, {});
  // A question without criteria is not rated.
  const closed = await api.send("POST", "/api/llm/exam-rating", { ...body, itemKey: m("s1") });
  expect([closed.status, await closed.text()]).toEqual([400, '{"error":"no_such_item"}']);

  const proposed = await api.sendJson("POST", "/api/llm/exam-rating", body);
  expect(proposed).toMatchObject({ itemKey: m("s3"), input: note, result: PROPOSAL, model: "m" });
  // The request: the task as set, the criteria by their titles and levels, the answer; the level
  // the first reply chose that the criterion does not have was asked again.
  const sent = ai.bodies[0]?.messages.map((x) => x.content).join("\n") ?? "";
  expect(sent).toContain("Write Tom a note.");
  expect(sent).toContain("- wann (When you come) — voiding: 3");
  expect(sent).toContain(note);
  expect(ai.bodies).toHaveLength(2);
  // Asked again for the same answer: the kept one, the model not asked.
  expect((await api.sendJson("POST", "/api/llm/exam-rating", body)).ts).toBe(proposed.ts);
  expect(ai.bodies).toHaveLength(2);

  // Kept in the run: shown with its events; nothing scored until the learner takes it.
  const state = await api.getJson(`/api/exams/runs/${run.id}`);
  expect(state.events.filter((e: { type: string }) => e.type === "llm_verdict")).toHaveLength(1);
  expect(state.run.result.pending).toBe(1);
  const taken = await api.sendJson("POST", `/api/exams/runs/${run.id}/ratings`, {
    id: ulid(),
    itemKey: m("s3"),
    ratings: { wann: 3, was: 1.5, form: 1 },
    by: "assistant",
    model: "m",
  });
  expect(taken.run.result.pending).toBeUndefined();
  expect(taken.run.result.modules.schreiben.points).toBe(5.5);

  // The prompt it would send, without sending it.
  const preview = await api.sendJson("POST", "/api/llm/exam-rating/prompt", body);
  expect(preview.body.messages[0].content).toContain("rater of a German language exam");
  expect(ai.bodies).toHaveLength(2);
});
