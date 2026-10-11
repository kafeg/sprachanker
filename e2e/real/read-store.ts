// The profile's database as a run-through reads it: read-only, beside the running server (Node's
// sqlite: Playwright runs on Node); and the names of its recordings.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CardRow, CardStateRow, EventRow, RunRow, Stored } from "./store.ts";

/** The profile's runs, events, cards and their states, and its recordings' file names. */
export function readStore(path: string): Stored {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const all = <T>(sql: string) => db.prepare(sql).all() as T[];
    const recordings = join(dirname(path), "recordings");
    return {
      runs: all<RunRow>(
        "select id, kind, context_key, status, end_reason, finished_at, plan_json, result_json from runs",
      ),
      events: all<EventRow>(
        "select id, ts, run_id, type, item_key, card_id, payload_json from events order by ts, id",
      ),
      cards: all<CardRow>("select id, lexeme_key, faces from cards"),
      cardState: all<CardStateRow>("select card_id, face, fsrs_json from card_state"),
      recordings: existsSync(recordings) ? readdirSync(recordings) : [],
    };
  } finally {
    db.close();
  }
}
