// An exam's speaking part said from its script: written once from the Teil's cards and the partner's
// own card, kept on the question in the exam run (asked again: the kept one); the learner's lines are
// the answer, rated with the script around them — their errors listed, pronunciation left to the
// learner.
import { expect, test } from "bun:test";
import { MODELL } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const m = (id: string) => `${MODELL}/q-${id}`;

const SCRIPT = {
  examiner: { gender: "f" },
  partner: { name: "Jonas", gender: "m" },
  lines: [
    { speaker: "examiner", text: "Guten Tag. Bitte fragen Sie Ihren Partner.", hint: "" },
    { speaker: "learner", text: "Was machst du am Wochenende?", hint: "Спросите о выходных." },
    { speaker: "partner", text: "Ich gehe schwimmen. Und du?", hint: "" },
    { speaker: "learner", text: "Ich lese gern.", hint: "Скажите, что вы делаете." },
    { speaker: "examiner", text: "Danke. Das war Teil 1.", hint: "" },
  ],
};
/** The script as kept: hints only on the learner's lines. */
const KEPT = {
  ...SCRIPT,
  lines: SCRIPT.lines.map(({ hint, ...l }) => (hint ? { ...l, hint } : l)),
};
const RATED = {
  criteria: [
    { id: "aufgabe", points: 4, reason: "Gefragt und geantwortet." },
    { id: "sprache", points: 2, reason: "Ein Fehler." },
  ],
  feedback: "Gut.",
  corrections: [
    { wrong: "Was du machst", right: "Was machst du", explanation: "Порядок слов." },
    { wrong: "schwimmen", right: "schwimmen", explanation: "—" },
  ],
};

/** A model writing the script, then rating the part. */
function model() {
  const bodies: Array<{ name: string; messages: Array<{ content: string }> }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const body = JSON.parse(init.body as string);
    const name: string = body.response_format?.json_schema?.name;
    bodies.push({ ...body, name });
    const reply = name === "exam_part" ? SCRIPT : RATED;
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

test("a speaking part: its script written once and kept in the run; said through, rated with the script around what was said", async () => {
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
  // Scripted while the mock exam runs: the learner gets its lines (the page hides the hints).
  const script = await api.sendJson("POST", "/api/llm/exam-part", body);
  expect(script).toMatchObject({ itemKey: m("p1"), result: KEPT, model: "m" });
  const sent = ai.bodies[0]?.messages.map((x) => x.content).join("\n") ?? "";
  expect(sent).toContain("Ask your partner about the weekend.");
  expect(sent).toContain("Karte 1: Wochenende?");
  expect(sent).toContain("<partner>\nAm Wochenende gehe ich schwimmen.\n</partner>");
  // Asked again: the kept one, the model not asked.
  expect((await api.sendJson("POST", "/api/llm/exam-part", body)).id).toBe(script.id);
  expect(ai.bodies).toHaveLength(1);
  // A question that is not a part said aloud is no part.
  expect((await api.send("POST", "/api/llm/exam-part", { ...body, itemKey: m("s3") })).status).toBe(
    400,
  );

  // Said through: the learner's lines are the answer; handed in, rated.
  const said = "Was du machst am Wochenende?\nIch lese gern.";
  await api.sendJson("POST", `/api/exams/runs/${run.id}/events`, {
    events: [
      {
        id: ulid(),
        type: "answered",
        itemKey: m("p1"),
        payload: {
          answer: {
            text: said,
            lines: [
              { transcript: "Was du machst am Wochenende?" },
              { transcript: "Ich lese gern." },
            ],
          },
          attempt: 1,
          ms: 1,
        },
      },
    ],
  });
  await api.sendJson("POST", `/api/exams/runs/${run.id}/finish`, {});
  const rated = await api.sendJson("POST", "/api/llm/exam-rating", body);
  // The script around what was said, the learner's errors listed (no-ops dropped).
  const asked = ai.bodies[1]?.messages.map((x) => x.content).join("\n") ?? "";
  expect(asked).toContain("Examiner: Guten Tag. Bitte fragen Sie Ihren Partner.");
  expect(asked).toContain("Learner (A): Was du machst am Wochenende?");
  expect(asked).toContain("Partner (B): Ich gehe schwimmen. Und du?");
  expect(asked).toContain("Then list the errors in the learner's (A) lines");
  expect(rated.result.corrections).toEqual([RATED.corrections[0]]);
});
