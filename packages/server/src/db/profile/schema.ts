// profile.sqlite (05). Events are append-only: no UPDATE or DELETE.
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
