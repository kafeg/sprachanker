// An exam's speaking part held with the assistant: the examiner opens it, every line of the learner's
// is answered by the examiner or the partner, all kept on the question in the exam run, until the part
// is closed; only while the run is being taken.
import { expect, test } from "bun:test";
import { MODELL } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const m = (id: string) => `${MODELL}/q-${id}`;

/** A model playing the part: it opens, answers once as the partner, then closes. */
function model() {
  const bodies: Array<{ messages: Array<{ content: string }> }> = [];
  const replies = [
    { lines: [{ speaker: "examiner", text: "Guten Tag. Bitte fragen Sie." }], done: false },
    { lines: [{ speaker: "partner", text: "Ich gehe schwimmen." }], done: false },
    {
      lines: [
        { speaker: "partner", text: "Und du?" },
        { speaker: "examiner", text: "Danke. Das war Teil 1." },
      ],
      done: true,
    },
  ];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    bodies.push(JSON.parse(init.body as string));
    const content = JSON.stringify(replies[bodies.length - 1]);
    return Response.json({ choices: [{ message: { content } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

test("a speaking part: opened by the examiner, the partner answers, closed — kept in the run", async () => {
  const ai = model();
  const api = await setup({ fetch: ai.fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const { run } = await api.sendJson("POST", "/api/exams/runs", {
    exam: MODELL,
    edition: "en-de",
    mode: "test",
    module: "sprechen",
  });
  const body = { runId: run.id, itemKey: m("p1"), language: "ru" };
  const turn = (text?: string) =>
    api.send("POST", "/api/llm/exam-conversation", { ...body, ...(text && { text }) });
  // biome-ignore lint/suspicious/noExplicitAny: a response read as the client reads it
  const read = async (text?: string): Promise<any> => (await turn(text)).json();

  // A line before the part is opened is refused; the examiner opens it.
  expect((await turn("Hallo")).status).toBe(400);
  const opened = await read();
  expect(opened.done).toBe(false);
  expect(opened.events.map((e: { payload: { speaker: string } }) => e.payload.speaker)).toEqual([
    "examiner",
  ]);
  // The request: the part's task and card, the partner's own card, the conversation not begun.
  const first = ai.bodies[0]?.messages.map((x) => x.content).join("\n") ?? "";
  expect(first).toContain("Ask your partner about the weekend.");
  expect(first).toContain("Karte 1: Wochenende?");
  expect(first).toContain("<partner>\nAm Wochenende gehe ich schwimmen.\n</partner>");
  expect(first).toContain("(not begun");
  // Opening again is refused: the next call answers a line of the learner's.
  expect((await turn()).status).toBe(400);

  const answered = await read("Was machst du am Wochenende?");
  expect(answered.events.map((e: { payload: { role: string } }) => e.payload.role)).toEqual([
    "user",
    "assistant",
  ]);
  expect(ai.bodies[1]?.messages.at(-1)?.content).toContain(
    "Learner (A): Was machst du am Wochenende?",
  );
  const closed = await read("Ich lese.");
  expect(closed.done).toBe(true);
  expect(closed.events.at(-1).payload).toMatchObject({ speaker: "examiner", done: true });
  // Closed: no more lines.
  const after = await turn("Noch etwas.");
  expect([after.status, await after.text()]).toEqual([409, '{"error":"exam_part_done"}']);

  // All of it on the question in the run, shown with its events (a running mock exam too).
  const state = await api.getJson(`/api/exams/runs/${run.id}`);
  const lines = state.events.filter((e: { type: string }) => e.type === "llm_turn");
  expect(lines.map((e: { payload: { text: string } }) => e.payload.text)).toEqual([
    "Guten Tag. Bitte fragen Sie.",
    "Was machst du am Wochenende?",
    "Ich gehe schwimmen.",
    "Ich lese.",
    "Und du?",
    "Danke. Das war Teil 1.",
  ]);
  expect(lines.every((e: { itemKey: string }) => e.itemKey === m("p1"))).toBe(true);

  // Handed in: the part can no longer be held.
  await api.sendJson("POST", `/api/exams/runs/${run.id}/finish`, {});
  const late = await api.send("POST", "/api/llm/exam-conversation", body);
  expect(late.status).toBe(409);
  expect(ai.bodies).toHaveLength(3);
});

test("the learner ends a part: kept once as their empty line, nothing more said or kept", async () => {
  const ai = model();
  const api = await setup({ fetch: ai.fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const { run } = await api.sendJson("POST", "/api/exams/runs", {
    exam: MODELL,
    edition: "en-de",
    mode: "test",
    module: "sprechen",
  });
  const body = { runId: run.id, itemKey: m("p1"), language: "ru" };
  await api.sendJson("POST", "/api/llm/exam-conversation", body);
  const ended = await api.sendJson("POST", "/api/llm/exam-conversation", { ...body, end: true });
  expect(ended.done).toBe(true);
  expect(ended.events.map((e: { payload: unknown }) => e.payload)).toEqual([
    { role: "user", text: "", done: true },
  ]);
  // Again: nothing more kept; no line after it.
  const again = await api.sendJson("POST", "/api/llm/exam-conversation", { ...body, end: true });
  expect(again).toEqual({ events: [], done: true });
  const after = await api.send("POST", "/api/llm/exam-conversation", { ...body, text: "Hallo" });
  expect(after.status).toBe(409);
  const state = await api.getJson(`/api/exams/runs/${run.id}`);
  expect(state.events.filter((e: { type: string }) => e.type === "llm_turn")).toHaveLength(2);
  expect(ai.bodies).toHaveLength(1);
});

test("only a part said aloud is held as a conversation", async () => {
  const api = await setup();
  const { run } = await api.sendJson("POST", "/api/exams/runs", {
    exam: MODELL,
    edition: "en-de",
    mode: "practice",
  });
  const res = await api.send("POST", "/api/llm/exam-conversation", {
    runId: run.id,
    itemKey: m("s3"),
    language: "en",
  });
  expect([res.status, await res.text()]).toEqual([400, '{"error":"no_such_item"}']);
});

test("a part ended with nothing said: begun again in practice, not in a mock exam; rated by its conversation only when answered by it", async () => {
  const bodies: Array<{ messages: Array<{ content: string }> }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const body = JSON.parse(init.body as string);
    bodies.push(body);
    const rating = String(body.messages[0]?.content).includes("rater of a");
    const reply = rating
      ? {
          criteria: [
            { id: "aufgabe", points: 2, reason: "Teilweise." },
            { id: "sprache", points: 2, reason: "Einfach." },
          ],
          feedback: "Mehr fragen.",
        }
      : {
          lines: [{ speaker: "examiner", text: `Bitte fragen Sie (${bodies.length}).` }],
          done: false,
        };
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  }) as unknown as typeof globalThis.fetch;
  const api = await setup({ fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const start = async (mode: string) =>
    (
      await api.sendJson("POST", "/api/exams/runs", {
        exam: MODELL,
        edition: "en-de",
        mode,
        module: "sprechen",
      })
    ).run;
  const talk = (runId: string, extra: object = {}) =>
    api.send("POST", "/api/llm/exam-conversation", {
      runId,
      itemKey: m("p1"),
      language: "en",
      ...extra,
    });

  // A mock exam: ended with nothing said, it stays so.
  const exam = await start("test");
  await talk(exam.id);
  await talk(exam.id, { end: true });
  const refused = await talk(exam.id);
  expect([refused.status, await refused.text()]).toEqual([409, '{"error":"exam_part_done"}']);
  await api.sendJson("POST", `/api/exams/runs/${exam.id}/finish`, {});

  // Practice: begun again with the examiner's opening as before (the same card, the same topic),
  // the model not asked anew.
  const practice = await start("practice");
  await talk(practice.id);
  await talk(practice.id, { end: true });
  const asked = bodies.length;
  const reopened = await talk(practice.id);
  expect(reopened.status).toBe(200);
  expect(bodies.length).toBe(asked);
  expect(
    (
      (await reopened.json()) as { events: Array<{ payload: { text: string; done?: boolean } }> }
    ).events.map((e) => [e.payload.text, e.payload.done]),
  ).toEqual([["Bitte fragen Sie (2).", undefined]]);
  expect((await talk(practice.id, { text: "Was machst du gern?" })).status).toBe(200);
  expect(bodies.at(-1)?.messages.at(-1)?.content).toContain("Learner (A): Was machst du gern?");
  // Said something, then ended: not begun again.
  await talk(practice.id, { end: true });
  expect((await talk(practice.id)).status).toBe(409);

  const answer = async (text: string) => {
    await api.sendJson("POST", `/api/exams/runs/${practice.id}/events`, {
      events: [
        {
          id: ulid(),
          type: "answered",
          itemKey: m("p1"),
          payload: { answer: { text }, attempt: 1, ms: 1 },
        },
      ],
    });
    await api.sendJson("POST", "/api/llm/exam-rating", {
      runId: practice.id,
      itemKey: m("p1"),
      language: "en",
    });
    return bodies.at(-1)?.messages.at(-1)?.content ?? "";
  };
  // Answered by the conversation: rated with it (its latest, begun again).
  const held = await answer("Was machst du gern?");
  expect(held).toContain(
    "<answer>\nExaminer: Bitte fragen Sie (2).\nLearner (A): Was machst du gern?",
  );
  expect(held.split("Bitte fragen Sie (2).")).toHaveLength(2);
  // Answered another way (the assistant switched off): its own answer alone.
  const other = await answer("Ich frage: Was machst du am Wochenende?");
  expect(other).toContain("<answer>\nIch frage: Was machst du am Wochenende?\n</answer>");
  expect(other).not.toContain("Learner (A)");
});
