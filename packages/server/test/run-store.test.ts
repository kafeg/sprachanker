import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LessonKey } from "@sprachanker/schema";
import { ulid } from "ulid";
import { z } from "zod";
import { openProfileDb } from "../src/runtime/bun.ts";
import { createRunStore, readStored } from "../src/services/run-store.ts";

const LESSON = "sprachanker.fixture/demo/00-01" as LessonKey;

function open() {
  const file = join(mkdtempSync(join(tmpdir(), "sprachanker-store-")), "profile.sqlite");
  let clock = 1000;
  const store = createRunStore({
    db: openProfileDb(file),
    now: () => (clock += 1),
    appVersion: "t",
  });
  return { store, sqlite: new Database(file) };
}

test("events are checked when written and stored all or nothing; a resent id is left as it is", () => {
  const { store } = open();
  const run = store.start("lesson", LESSON, { edition: "ru-de" });
  const step = { id: ulid(), type: "step_done" as const, payload: { step: "words" as const } };
  store.append(run.id, [step]);
  // A payload that does not fit its type: nothing of the batch is stored.
  expect(() =>
    store.append(run.id, [
      { type: "step_done", payload: { step: "grammar:1" } },
      { type: "step_done", payload: { step: "nope" } as never },
    ]),
  ).toThrow();
  // The same id sent to another run: refused as a client's mistake, not a server fault.
  const other = store.start("lesson", "sprachanker.fixture/demo/00-02" as LessonKey, {
    edition: "ru-de",
  });
  expect(() => store.append(other.id, [step])).toThrow("event_of_another_run");
  const seen: string[] = [];
  store.append(run.id, [step], { onStored: (e) => seen.push(e.id) });
  expect(seen).toEqual([step.id]);
  expect(store.events(run.id).map((e) => e.id)).toEqual([step.id]);
});

test("answers numbered per item; one sent again keeps its number; an id stored as another event tells no answer", () => {
  const { store } = open();
  const run = store.start("lesson", LESSON, { edition: "ru-de" });
  const outcome = { result: "correct" as const, score: 1, ruleIds: [], lexemes: [] };
  const answer = (id: string, itemKey = "k#1") => ({
    id,
    type: "answered" as const,
    itemKey,
    payload: { answer: {}, attempt: 1, ms: 1, outcome },
  });
  const step = { id: ulid(), type: "step_done" as const, payload: { step: "words" as const } };
  store.append(run.id, [step]);
  const [a, b] = [ulid(), ulid()];
  expect(store.appendAnswers(run.id, [answer(a), answer(b)]).attempts).toEqual({ [a]: 1, [b]: 2 });
  // Sent again with an id the step has: the step stays, no answer of it is told.
  const again = store.appendAnswers(run.id, [answer(b), answer(step.id)]);
  expect(again).toEqual({ outcomes: { [b]: outcome }, attempts: { [b]: 2 } });
});

test("only an active run takes events and ends; an explanation may go to a finished one", () => {
  const { store } = open();
  const run = store.start("lesson", LESSON, { edition: "ru-de" });
  expect(store.end(run.id, "finished", "completed")?.status).toBe("finished");
  // Ending again changes nothing (a run started over stays as it is).
  expect(store.end(run.id, "abandoned", "user")).toBeUndefined();
  expect(store.get(run.id)?.status).toBe("finished");
  expect(() => store.append(run.id, [{ type: "step_done", payload: { step: "words" } }])).toThrow(
    "run_not_active",
  );
  store.append(
    run.id,
    [
      {
        type: "llm_verdict",
        itemKey: `${LESSON}/ex-01#1`,
        payload: {
          task: "explain",
          input: "",
          result: "why",
          model: "m",
          latencyMs: 1,
          attempt: 1,
        },
      },
    ],
    { anyStatus: true },
  );
  expect(store.events(run.id, ["llm_verdict"])).toHaveLength(1);
});

test("a stored row that no longer reads is left out, not the whole list", () => {
  const { store, sqlite } = open();
  const run = store.start("chat", LESSON, { edition: "ru-de" });
  store.append(run.id, [{ type: "llm_turn", payload: { role: "user", text: "Hallo" } }]);
  sqlite
    .query(
      "INSERT INTO events (id, run_id, ts, type, payload_json) VALUES (?, ?, 5000, 'llm_turn', '{\"role\":\"robot\"}')",
    )
    .run(ulid(), run.id);
  // Not JSON at all: left out too.
  sqlite
    .query(
      "INSERT INTO events (id, run_id, ts, type, payload_json) VALUES (?, ?, 5001, 'llm_turn', '{oops')",
    )
    .run(ulid(), run.id);
  expect(store.payloads(run.id, "llm_turn").map((t) => t.text)).toEqual(["Hallo"]);
  // A plan or result column likewise.
  expect(readStored("{oops", z.object({ a: z.number() }), "test")).toBeUndefined();
  expect(readStored('{"a":1}', z.object({ a: z.number() }), "test")).toEqual({ a: 1 });
  expect(readStored(null, z.object({ a: z.number() }), "test")).toBeUndefined();
});

test("replace: a new run in place of the active one, which ends as asked, in one go", () => {
  const { store } = open();
  const first = store.start("scene", LESSON, { edition: "ru-de" });
  const second = store.replace(
    "scene",
    LESSON,
    { status: "abandoned", reason: "user" },
    {
      edition: "ru-de",
      plan: { title: "x" },
    },
  );
  expect(store.get(first.id)?.status).toBe("abandoned");
  expect([store.active("scene", LESSON)?.id, second.planJson]).toEqual([
    second.id,
    '{"title":"x"}',
  ]);
  // Nothing active: a run is started.
  const day = store.replace("review", null, { status: "finished", reason: "completed" });
  expect(store.active("review", null)?.id).toBe(day.id);
});

test("verdicts typed by their task, checked when written, newest first; events of many runs in one call", () => {
  const { store } = open();
  const a = store.start("lesson", LESSON, { edition: "ru-de" });
  const b = store.start("chat", LESSON, { edition: "ru-de" });
  const spoken = (input: string) => ({
    type: "llm_verdict" as const,
    itemKey: "x#2",
    payload: {
      task: "speaking" as const,
      input,
      result: { verdict: "good" as const, corrected: input, corrections: [], feedback: "" },
      model: "m",
      latencyMs: 1,
    },
  });
  const why = {
    type: "llm_verdict" as const,
    itemKey: "x#1",
    payload: { task: "explain" as const, input: "", result: "why", model: "m", latencyMs: 1 },
  };
  store.append(a.id, [spoken("Ja"), why, spoken("Nein")]);
  // A result that does not fit its task is refused when written.
  expect(() =>
    store.append(a.id, [
      { ...why, payload: { ...why.payload, task: "speaking", result: "not a check" } } as never,
    ]),
  ).toThrow();
  expect(
    store.verdicts("speaking", { kind: "lesson", about: LESSON }).map((v) => v.result.corrected),
  ).toEqual(["Nein", "Ja"]);
  expect(store.verdicts("explain", { runIds: [a.id], itemKey: "x#1" })).toHaveLength(1);
  store.append(b.id, [{ type: "llm_turn", payload: { role: "user", text: "Hallo" } }]);
  const byRun = store.eventsOf([a.id, b.id], ["llm_turn"]);
  expect([byRun.get(a.id)?.length, byRun.get(b.id)?.map((e) => e.type)]).toEqual([0, ["llm_turn"]]);
});

test("removing runs takes their events with them, in one go", () => {
  const { store, sqlite } = open();
  const a = store.start("chat", LESSON, { edition: "ru-de" });
  const b = store.start("scene", LESSON, { edition: "ru-de" });
  store.append(a.id, [{ type: "llm_turn", payload: { role: "user", text: "1" } }]);
  store.append(b.id, [{ type: "llm_turn", payload: { role: "user", text: "2" } }]);
  expect(store.idsOf({ lesson: LESSON }).sort()).toEqual([a.id, b.id].sort());
  expect(store.remove([a.id])).toEqual({ runs: 1, events: 1 });
  expect(sqlite.query("SELECT run_id FROM events").all()).toEqual([{ run_id: b.id }]);
});

test("the recordings answers hold are found in runs of every kind, exams too", () => {
  const { store, sqlite } = open();
  const outcome = { result: "unscored" as const, score: 0, ruleIds: [], lexemes: [] };
  const answered = (itemKey: string, recording: string) => ({
    type: "answered" as const,
    itemKey,
    payload: {
      answer: { text: "", speech: { recording, transcript: "" } },
      attempt: 1,
      ms: 1,
      outcome,
    },
  });
  const lesson = store.start("lesson", LESSON, { edition: "ru-de" });
  store.append(lesson.id, [answered(`${LESSON}/ex-01#1`, "rec-lesson")]);
  const exam = store.start("exam", "sprachanker.fixture/demo/exams/modell" as never, {
    edition: "ru-de",
  });
  store.append(exam.id, [answered("sprachanker.fixture/demo/exams/modell/q-1", "rec-exam")]);
  expect(store.recordingIds().sort()).toEqual(["rec-exam", "rec-lesson"]);
  expect(store.recordingIds([exam.id])).toEqual(["rec-exam"]);
  expect(store.recordingIds([])).toEqual([]);
  // An answer stored in a shape that no longer reads still holds its take: it is never swept.
  sqlite.run(
    "INSERT INTO events (id, run_id, ts, type, payload_json) VALUES (?, ?, ?, 'answered', ?)",
    [ulid(), exam.id, 5000, JSON.stringify({ answer: { recording: "rec-old" }, attempt: "?" })],
  );
  expect(store.recordingIds([exam.id]).sort()).toEqual(["rec-exam", "rec-old"]);
});
