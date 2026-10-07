import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LessonKey } from "@sprachanker/schema";
import { ulid } from "ulid";
import { openProfileDb } from "../src/runtime/bun.ts";
import { createRunStore } from "../src/services/run-store.ts";

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
  const seen: string[] = [];
  store.append(run.id, [step], { onStored: (e) => seen.push(e.id) });
  expect(seen).toEqual([step.id]);
  expect(store.events(run.id).map((e) => e.id)).toEqual([step.id]);
});

test("only an active run takes events and ends; an explanation may go to a finished one", () => {
  const { store } = open();
  const run = store.start("lesson", LESSON, { edition: "ru-de" });
  expect(store.end(run.id, "finished", "completed")?.status).toBe("finished");
  // Ending again changes nothing (a run started over stays as it is).
  expect(store.end(run.id, "abandoned", "user")).toBeUndefined();
  expect(store.get(run.id)?.status).toBe("finished");
  expect(() => store.append(run.id, [{ type: "step_done", payload: { step: "words" } }])).toThrow(
    "run is not active",
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
  expect(store.payloads(run.id, "llm_turn").map((t) => t.text)).toEqual(["Hallo"]);
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
