// Exam runs through the API, on the fixture course's mini exam: two general questions and one of the
// learner's state (Berlin or Bavaria), pass marks 2 and 3.
import { expect, test } from "bun:test";
import { EXAM, MODELL } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const q = (id: string) => `${EXAM}/q-${id}`;
/** The right answers of the mini exam. */
const RIGHT: Record<string, string> = { "001": "b", "002": "a", "be-01": "a", "by-01": "a" };
const answer = (id: string, optionId: string) => ({
  id: ulid(),
  type: "answered",
  itemKey: q(id),
  payload: { answer: { optionId }, attempt: 1, ms: 500 },
});

async function inBerlin() {
  const api = await setup();
  await api.send("PUT", "/api/settings", { key: "exam.federalState", value: "be" });
  return api;
}

test("the exams installed, with what the learner still has to set and their standing", async () => {
  const api = await setup();
  const [mini] = await api.getJson("/api/exams");
  expect(mini).toMatchObject({
    key: EXAM,
    kind: "course",
    titles: { "ru-de": "Мини-тест", "en-de": "Mini test" },
    questions: 4,
    asked: 3,
    needs: ["exam.federalState"],
    readiness: 0,
    active: null,
    last: null,
    tests: 0,
  });
  const started = await api.send("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "ru-de",
    mode: "test",
  });
  expect(started.status).toBe(409);
  expect(await started.text()).toContain("exam_needs_setting");
});

test("a mock exam: drawn for the state, timed, its answers kept to itself until handed in", async () => {
  const api = await inBerlin();
  const { run } = await api.sendJson("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "ru-de",
    mode: "test",
  });
  expect(run.plan.mode).toBe("test");
  expect([...run.plan.items].sort()).toEqual([q("001"), q("002"), q("be-01")]);
  expect(run.plan.snapshot.map((i: { key: string }) => i.key)).toEqual(run.plan.items);
  // Each question with the section it was drawn from, so the result never depends on the catalogue.
  expect(run.plan.sections).toEqual({
    [q("001")]: `${EXAM}/s-general`,
    [q("002")]: `${EXAM}/s-general`,
    [q("be-01")]: `${EXAM}/s-state`,
  });
  expect(run.plan.deadline).toBeGreaterThan(run.startedAt);

  // One right, one wrong, then changed to right; the outcomes are not told.
  const sent = await api.sendJson("POST", `/api/exams/runs/${run.id}/events`, {
    events: [answer("001", "b"), answer("002", "b"), answer("002", "a")],
  });
  expect(sent.outcomes).toEqual({});
  expect(Object.values(sent.attempts)).toEqual([1, 1, 2]);
  const opened = await api.getJson(`/api/exams/runs/${run.id}`);
  expect(opened.events).toHaveLength(3);
  expect(opened.events.every((e: { payload: object }) => !("outcome" in e.payload))).toBe(true);
  // A question not asked in this run is refused.
  const stray = await api.send("POST", `/api/exams/runs/${run.id}/events`, {
    events: [answer("by-01", "a")],
  });
  expect(stray.status).toBe(400);

  const done = await api.sendJson("POST", `/api/exams/runs/${run.id}/finish`, {});
  expect(done.run.status).toBe("finished");
  expect(done.run.endReason).toBe("completed");
  expect(done.run.result).toEqual({
    points: 2,
    max: 3,
    answered: 2,
    sections: {
      [`${EXAM}/s-general`]: { points: 2, max: 2 },
      [`${EXAM}/s-state`]: { points: 0, max: 1 },
    },
    passed: ["pass"],
    pass: true,
  });
  // Handed in: every answer with its outcome.
  expect(
    done.events.map((e: { payload: { outcome: { result: string } } }) => e.payload.outcome.result),
  ).toEqual(["correct", "wrong", "correct"]);
  // Handed in again: the same result; answers after it are refused.
  expect(
    (await api.sendJson("POST", `/api/exams/runs/${run.id}/finish`, {})).run.result.points,
  ).toBe(2);
  expect(
    (await api.send("POST", `/api/exams/runs/${run.id}/events`, { events: [answer("001", "a")] }))
      .status,
  ).toBe(409);

  const [mini] = await api.getJson("/api/exams");
  expect(mini).toMatchObject({ needs: [], tests: 1, active: null });
  expect(mini.last.result.points).toBe(2);
  expect(mini.best.id).toBe(run.id);
  // Known: 001 and 002 (their latest answers right) of the three open to a learner in Berlin.
  expect(mini.readiness).toBeCloseTo(2 / 3);
});

test("practice: each answer checked at once, the questions answered wrongly first", async () => {
  const api = await inBerlin();
  const { run: test1 } = await api.sendJson("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "en-de",
    mode: "test",
  });
  await api.sendJson("POST", `/api/exams/runs/${test1.id}/events`, {
    events: [answer("be-01", "b"), answer("001", RIGHT["001"] as string)],
  });
  await api.sendJson("POST", `/api/exams/runs/${test1.id}/finish`, {});

  const { run } = await api.sendJson("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "en-de",
    mode: "practice",
  });
  expect(run.plan.mode).toBe("practice");
  expect(run.plan.deadline).toBeNull();
  // The wrong one, then the one not seen, then the one known; the other state's question not at all.
  expect(run.plan.items).toEqual([q("be-01"), q("002"), q("001")]);
  const first = answer("be-01", "a");
  const sent = await api.sendJson("POST", `/api/exams/runs/${run.id}/events`, { events: [first] });
  expect(sent.outcomes[first.id].result).toBe("correct");
  const done = await api.sendJson("POST", `/api/exams/runs/${run.id}/finish`, {});
  // Practice is scored over the questions answered.
  expect(done.run.result).toMatchObject({ points: 1, max: 1, answered: 1 });
  const page = await api.getJson(`/api/exams/page?exam=${encodeURIComponent(EXAM)}&edition=en-de`);
  expect(page.locale.title).toBe("Mini test");
  expect(page.stats[q("be-01")]).toEqual({ last: "right", right: 1, wrong: 1 });
  expect(page.runs.map((r: { id: string }) => r.id)).toEqual([run.id, test1.id]);
});

test("a new practice ends the active one as abandoned; an exam's runs go with its course's progress", async () => {
  const api = await inBerlin();
  const start = (mode: string) =>
    api.sendJson("POST", "/api/exams/runs", { exam: EXAM, edition: "ru-de", mode });
  const { run: first } = await start("practice");
  const { run: second } = await start("practice");
  expect((await api.getJson(`/api/exams/runs/${first.id}`)).run.status).toBe("abandoned");
  expect((await api.getJson(`/api/exams/runs/${second.id}`)).run.status).toBe("active");
  // An edition the exam is not installed in is refused.
  const elsewhere = await api.send("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "fr-de",
    mode: "practice",
  });
  expect(elsewhere.status).toBe(404);
  const [series, course] = EXAM.split("/") as [string, string];
  await api.sendJson("POST", "/api/progress/reset", { series, course });
  expect((await api.get(`/api/exams/runs/${second.id}`)).status).toBe(404);
});

test("a running mock exam: no other run meanwhile, its answers kept out of the stats, handed in when its time is up", async () => {
  const api = await inBerlin();
  const page = () => api.getJson(`/api/exams/page?exam=${encodeURIComponent(EXAM)}&edition=ru-de`);
  const { run, now } = await api.sendJson("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "ru-de",
    mode: "test",
  });
  expect(now).toBeGreaterThanOrEqual(run.startedAt);
  await api.sendJson("POST", `/api/exams/runs/${run.id}/events`, { events: [answer("001", "a")] });
  // What the answer says of its question shows nowhere before the exam is handed in.
  expect((await page()).stats).toEqual({});
  expect((await page()).active.id).toBe(run.id);
  const practice = await api.send("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "ru-de",
    mode: "practice",
  });
  expect(practice.status).toBe(409);
  expect(await practice.text()).toContain("exam_test_running");

  // Just past the deadline: an answer on its way still counts.
  api.advance(run.plan.deadline - now + 5_000);
  const late = await api.send("POST", `/api/exams/runs/${run.id}/events`, {
    events: [answer("002", "a")],
  });
  expect(late.status).toBe(200);
  // Past the grace: refused, and the exam handed in as it stood, its time over.
  api.advance(30_000);
  const tooLate = await api.send("POST", `/api/exams/runs/${run.id}/events`, {
    events: [answer("be-01", "a")],
  });
  expect(tooLate.status).toBe(409);
  expect(await tooLate.text()).toContain("exam_time_over");
  const { run: ended } = await api.getJson(`/api/exams/runs/${run.id}`);
  expect(ended).toMatchObject({ status: "finished", endReason: "timeout" });
  expect(ended.result).toMatchObject({ points: 1, max: 3, answered: 2 });
  expect((await page()).stats[q("001")]).toEqual({ last: "wrong", right: 0, wrong: 1 });

  // One left running and never come back to is handed in when the exam is next looked at.
  const { run: left } = await api.sendJson("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "ru-de",
    mode: "test",
  });
  api.advance(left.plan.deadline - left.startedAt + 60_000);
  const [mini] = await api.getJson("/api/exams");
  expect(mini.active).toBeNull();
  expect(mini.last.id).toBe(left.id);
  expect(mini.last).toMatchObject({ status: "finished", endReason: "timeout" });
});

test("the Notebook lists the mock exams handed in, newest first, with their results", async () => {
  const api = await inBerlin();
  const { run } = await api.sendJson("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "en-de",
    mode: "test",
  });
  await api.sendJson("POST", `/api/exams/runs/${run.id}/events`, { events: [answer("001", "b")] });
  await api.sendJson("POST", `/api/exams/runs/${run.id}/finish`, {});
  const { run: practice } = await api.sendJson("POST", "/api/exams/runs", {
    exam: EXAM,
    edition: "en-de",
    mode: "practice",
  });
  await api.sendJson("POST", `/api/exams/runs/${practice.id}/finish`, {});
  const { exams } = await api.getJson("/api/notebook");
  expect(exams).toHaveLength(1);
  expect(exams[0]).toMatchObject({ key: EXAM, title: "Mini test" });
  expect(
    exams[0].runs.map((r: { id: string; result: { points: number } }) => [r.id, r.result.points]),
  ).toEqual([[run.id, 1]]);
});

test("a language exam: one module taken alone, timed by it, its Teile whole; the whole exam judged by all its marks", async () => {
  const api = await setup();
  const m = (id: string) => `${MODELL}/q-${id}`;
  const start = (module?: string) =>
    api.sendJson("POST", "/api/exams/runs", {
      exam: MODELL,
      edition: "en-de",
      mode: "test",
      ...(module && { module }),
    });
  const { run: lesen, now } = await start("lesen");
  expect(lesen.plan).toMatchObject({ module: "lesen", items: [m("l1"), m("l2"), m("l3")] });
  expect(lesen.plan.deadline - now).toBeGreaterThan(170_000);
  expect(lesen.plan.deadline - now).toBeLessThanOrEqual(180_000);
  const answer = (id: string, value: unknown) => ({
    id: ulid(),
    type: "answered",
    itemKey: m(id),
    payload: { answer: value, attempt: 1, ms: 1 },
  });
  await api.sendJson("POST", `/api/exams/runs/${lesen.id}/events`, {
    events: [answer("l1", { optionId: "b" }), answer("l2", { optionId: "b" })],
  });
  const { run: done } = await api.sendJson("POST", `/api/exams/runs/${lesen.id}/finish`, {});
  // Reading alone: 2 of 3, 16.67 of 25; no pass mark of its own, so not judged.
  expect(done.result).toMatchObject({
    points: 2,
    max: 3,
    modules: { lesen: { points: 2, max: 3, scaled: 16.67 } },
    passed: [],
  });
  expect(done.result.pass).toBeUndefined();
  // A module the exam does not have is refused.
  const unknown = await api.send("POST", "/api/exams/runs", {
    exam: MODELL,
    edition: "en-de",
    mode: "test",
    module: "sprechen",
  });
  expect(unknown.status).toBe(400);

  // The whole exam: every Teil whole, the example never asked; typed answers checked.
  const { run: whole } = await start();
  expect(whole.plan.items).toEqual(["h1", "h2", "h3", "l1", "l2", "l3", "s1", "s2"].map(m));
  await api.sendJson("POST", `/api/exams/runs/${whole.id}/events`, {
    events: [
      ...["h1", "h2", "h3"].map((id) => answer(id, { optionId: "a" })),
      answer("l1", { optionId: "b" }),
      answer("l2", { optionId: "b" }),
      answer("l3", { optionId: "b" }),
      answer("s1", { g1: "Tom Weber" }),
      answer("s2", { g1: "Tee" }),
    ],
  });
  const { run: all } = await api.sendJson("POST", `/api/exams/runs/${whole.id}/finish`, {});
  // 25 + 25 + 12.5 = 62.5: over 45, writing over 10 — both marks, so passed.
  expect(all.result).toMatchObject({
    points: 7,
    max: 8,
    modules: {
      hoeren: { scaled: 25 },
      lesen: { scaled: 25 },
      schreiben: { points: 1, max: 2, scaled: 12.5 },
    },
    passed: ["pass", "written"],
    pass: true,
  });
});
