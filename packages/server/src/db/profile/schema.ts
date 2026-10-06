// profile.sqlite (05). Events are append-only: no UPDATE or DELETE.
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    contextKey: text("context_key"),
    courseKey: text("course_key"),
    edition: text("edition"),
    contentVersion: text("content_version"),
    appVersion: text("app_version").notNull(),
    planJson: text("plan_json"),
    status: text("status").notNull(),
    endReason: text("end_reason"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    resultJson: text("result_json"),
  },
  (t) => [index("runs_context").on(t.contextKey, t.status)],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    ts: integer("ts").notNull(),
    deviceId: text("device_id"),
    type: text("type").notNull(),
    itemKey: text("item_key"),
    cardId: text("card_id"),
    payloadJson: text("payload_json").notNull(),
  },
  (t) => [index("events_run").on(t.runId, t.ts)],
);

/** The profile's API keys, AES-256-GCM sealed; never returned by the API (06, "Secrets"). */
export const secrets = sqliteTable("secrets", {
  providerId: text("provider_id").primaryKey(),
  valueEncrypted: text("value_encrypted").notNull(),
});

/** Provider and model per LLM task; `default` serves tasks without their own route (07). */
export const llmRoutes = sqliteTable("llm_routes", {
  task: text("task").primaryKey(),
  providerId: text("provider_id").notNull(),
  model: text("model"),
  paramsJson: text("params_json").notNull(),
});

/** Cards for spaced repetition (04, 05): one per lexeme, with the faces enabled for it. */
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    lexemeKey: text("lexeme_key"),
    sourceKey: text("source_key"),
    originRunId: text("origin_run_id"),
    originEventId: text("origin_event_id"),
    fieldsJson: text("fields_json"),
    /** Enabled faces, comma-separated. */
    faces: text("faces").notNull(),
    displayCacheJson: text("display_cache_json"),
    suspended: integer("suspended").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("cards_lexeme").on(t.lexemeKey)],
);

/** FSRS state per card face, written with each `card_review` event; rebuildable from them (05). */
export const cardState = sqliteTable(
  "card_state",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    face: text("face").notNull(),
    fsrsJson: text("fsrs_json").notNull(),
    dueAt: integer("due_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.face] }), index("card_state_due").on(t.dueAt)],
);
