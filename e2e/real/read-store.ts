// The profile's database as a run-through reads it: read-only, beside the running server (Node's
// sqlite: Playwright runs on Node).
import { DatabaseSync } from "node:sqlite";
import type { CardRow, EventRow, RunRow, Stored } from "./store.ts";

/** The profile's runs, events and cards. */
export function readStore(path: string): Stored {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const all = <T>(sql: string) => db.prepare(sql).all() as T[];
    return {
      runs: all<RunRow>("select id, kind, context_key, status, end_reason from runs"),
      events: all<EventRow>(
        "select run_id, type, item_key, card_id, payload_json from events order by ts",
      ),
      cards: all<CardRow>("select id, lexeme_key from cards"),
    };
  } finally {
    db.close();
  }
}
