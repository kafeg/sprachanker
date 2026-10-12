// profile.sqlite. Events are append-only: no UPDATE or DELETE.
import type { RunEndReason, RunKind, RunStatus } from "@sprachanker/schema";
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
    // Typed by schema's enums (TypeScript only: SQLite keeps text).
    kind: text("kind").$type<RunKind>().notNull(),
    contextKey: text("context_key"),
    courseKey: text("course_key"),
    edition: text("edition"),
    appVersion: text("app_version").notNull(),
    planJson: text("plan_json"),
    status: text("status").$type<RunStatus>().notNull(),
    endReason: text("end_reason").$type<RunEndReason>(),
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
  // By run (a run's events); by type and time (the day's card answers, verdicts, activity).
  (t) => [index("events_run").on(t.runId, t.ts), index("events_type_ts").on(t.type, t.ts)],
);

/** The profile's API keys, AES-256-GCM sealed; never returned by the API. */
export const secrets = sqliteTable("secrets", {
  providerId: text("provider_id").primaryKey(),
  valueEncrypted: text("value_encrypted").notNull(),
});

/** Provider and model per LLM task; `default` serves tasks without their own route. */
export const llmRoutes = sqliteTable("llm_routes", {
  task: text("task").primaryKey(),
  providerId: text("provider_id").notNull(),
  model: text("model"),
});

/** Cards for spaced repetition: one per lexeme, with the faces enabled for it. */
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    lexemeKey: text("lexeme_key"),
    /** The language of the card's translation (its edition's source language): a word learned in Russian
     *  and in English is two notes. */
    translationLang: text("translation_lang").notNull(),
    sourceKey: text("source_key"),
    /** The run the card was made in — a lesson run's "Words" step; emptied when that run is deleted
     *  (resetting progress). */
    originRunId: text("origin_run_id").references(() => runs.id, { onDelete: "set null" }),
    /** Enabled faces, comma-separated. */
    faces: text("faces").notNull(),
    displayCacheJson: text("display_cache_json"),
    /** The whole note suspended (Anki: suspend note). */
    suspended: integer("suspended").notNull().default(0),
    /** Marked by the learner (Anki: mark note, `*`). */
    marked: integer("marked").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("cards_lexeme").on(t.lexemeKey, t.translationLang)],
);

/**
 * One face of a card (an Anki card): its FSRS state, written with each `card_review` event and
 * rebuildable from them — none while the face is new — and what the learner set on it: suspended,
 * buried until a day, a flag (1–7).
 */
export const cardState = sqliteTable(
  "card_state",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    face: text("face").notNull(),
    fsrsJson: text("fsrs_json"),
    suspended: integer("suspended").notNull().default(0),
    buriedUntil: integer("buried_until"),
    flag: integer("flag").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.face] })],
);
