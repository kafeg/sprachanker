// A profile file's database made ready, run in a Worker
// (profile-db-worker.ts). The file is untrusted: its views, triggers, CHECK constraints and indexed
// expressions are SQL of its own that runs when it is read or written. So before anything but reading
// `sqlite_master`, its schema must be exactly what this app's migrations make — after some of them —:
// then no SQL of the file's own is left to run. Only then is it checked, read and migrated.
import { Database } from "bun:sqlite";
import type { SettingKey } from "@sprachanker/schema";
import { migrations } from "../db/profile/migrations/index.ts";
import { openProfileSqlite } from "./bun.ts";

export type Settled = "ok" | "newer" | "damaged";

/** The setting with the LLM providers' endpoints set by the learner, by provider id. */
const ENDPOINTS: SettingKey = "llm.endpoints";

/** A profile database's LLM endpoints changed in place (a profile file's copy: exported, imported); a
 *  value that does not read is dropped (it would read as unset). */
export function editEndpoints(
  sqlite: Database,
  edit: (endpoints: Record<string, string>) => Record<string, string>,
) {
  const row = sqlite
    .query<{ value_json: string }, [string]>("SELECT value_json FROM settings WHERE key = ?")
    .get(ENDPOINTS);
  if (!row) return;
  let endpoints: unknown;
  try {
    endpoints = JSON.parse(row.value_json);
  } catch {}
  const valid =
    !!endpoints &&
    typeof endpoints === "object" &&
    !Array.isArray(endpoints) &&
    Object.values(endpoints).every((url) => typeof url === "string");
  if (!valid) sqlite.run("DELETE FROM settings WHERE key = ?", [ENDPOINTS]);
  else
    sqlite.run("UPDATE settings SET value_json = ? WHERE key = ?", [
      JSON.stringify(edit(endpoints as Record<string, string>)),
      ENDPOINTS,
    ]);
}

/** A database's schema as `sqlite_master` lists it (SQLite's own entries too: an autoindex, or a
 *  `sqlite_stat1` left by ANALYZE), whitespace aside: one text to compare. */
function schemaOf(sqlite: Database) {
  const rows = sqlite
    .query<{ type: string; name: string; tbl_name: string; sql: string | null }, []>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master",
    )
    .all()
    .map((r) => [r.type, r.name, r.tbl_name, r.sql?.replace(/\s+/g, " ").trim() ?? null]);
  return JSON.stringify(rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)));
}

let made: Array<{ tags: string[]; schema: string }> | undefined;
/** The schema after each count of this app's migrations (one or more), made once in memory. */
function schemas() {
  made ??= migrations.map((_, i) => {
    const sqlite = openProfileSqlite(":memory:", Date.now(), i + 1);
    try {
      return { tags: migrations.slice(0, i + 1).map((m) => m.tag), schema: schemaOf(sqlite) };
    } finally {
      sqlite.close();
    }
  });
  return made;
}

/** The migrations a database has, by the exact schema they make and the tags it lists (undefined: not
 *  this app's database, or not sound); "newer" when it lists a migration this app does not know. */
function check(file: string): string[] | "newer" | undefined {
  const sqlite = new Database(file, { readonly: true });
  try {
    // Nothing the schema names runs functions it may not, nor writes.
    sqlite.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON; PRAGMA cell_size_check = ON");
    const schema = schemaOf(sqlite);
    const matching = schemas().filter((s) => s.schema === schema);
    if (!matching.length) return undefined;
    // This app's tables and indexes only, nothing else: now they may be read.
    const integrity = sqlite
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .all()
      .map((r) => r.integrity_check);
    if (integrity.join() !== "ok" || sqlite.query("PRAGMA foreign_key_check").all().length)
      return undefined;
    const tags = sqlite
      .query<{ tag: string }, []>("SELECT tag FROM _migrations ORDER BY rowid")
      .all()
      .map((r) => r.tag);
    if (tags.some((tag) => !migrations.some((m) => m.tag === tag))) return "newer";
    return matching.some((s) => JSON.stringify(s.tags) === JSON.stringify(tags)) ? tags : undefined;
  } finally {
    sqlite.close();
  }
}

/** The database checked, then migrated forward (the usual copy beside it first, 05 "Migrations"), its
 *  secrets emptied and only the endpoints of the providers in `endpoints` kept (the others' would
 *  not count). */
export function settleProfileDb(file: string, endpoints: readonly string[]): Settled {
  let checked: ReturnType<typeof check>;
  try {
    checked = check(file);
  } catch {
    // Not a database, or one SQLite cannot read.
    return "damaged";
  }
  if (checked === "newer") return "newer";
  if (!checked) return "damaged";
  let sqlite: Database | undefined;
  try {
    sqlite = openProfileSqlite(file);
    sqlite.exec("DELETE FROM secrets");
    editEndpoints(sqlite, (set) =>
      Object.fromEntries(Object.entries(set).filter(([id]) => endpoints.includes(id))),
    );
    return schemaOf(sqlite) === schemas().at(-1)?.schema ? "ok" : "damaged";
  } catch {
    return "damaged";
  } finally {
    sqlite?.close();
  }
}
