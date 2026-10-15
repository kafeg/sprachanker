// A profile file's database made ready, over any SQLite the runtime gives (SqlFiles: Bun's in a
// Worker, profile-db-worker.ts; the phone's sql.js). The file is untrusted: its views, triggers, CHECK
// constraints and indexed expressions are SQL of its own that runs when it is read or written. So
// before anything but reading `sqlite_master`, its schema must be exactly what this app's migrations
// make — after some of them —: then no SQL of the file's own is left to run. Only then is it checked,
// read and migrated.
import type { SettingKey } from "@sprachanker/schema";
import { migrations } from "../db/profile/migrations/index.ts";

export type Settled = "ok" | "newer" | "damaged";

/** A database as the profile files' code uses one. */
export interface SqlDb {
  exec(sql: string): void;
  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, ...params: unknown[]): void;
  /** Let go (a database the runtime holds in memory written back first). */
  close(): void;
}

/** The runtime's SQLite for profile files. */
export interface SqlFiles {
  /** A database file opened as it is (`readonly`: nothing written). */
  open(file: string, options?: { readonly?: boolean }): SqlDb;
  /** A database file opened with this app's profile migrations applied — the first `upTo` of
   *  them (`:memory:`: a new one in memory). */
  migrated(file: string, upTo?: number): SqlDb;
}

/** The setting with the LLM providers' endpoints set by the learner, by provider id. */
const ENDPOINTS: SettingKey = "llm.endpoints";

/** A profile database's LLM endpoints changed in place (a profile file's copy: exported, imported); a
 *  value that does not read is dropped (it would read as unset). */
export function editEndpoints(
  sqlite: SqlDb,
  edit: (endpoints: Record<string, string>) => Record<string, string>,
) {
  const row = sqlite.all("SELECT value_json FROM settings WHERE key = ?", ENDPOINTS)[0];
  if (!row) return;
  let endpoints: unknown;
  try {
    endpoints = JSON.parse(String(row.value_json));
  } catch {}
  const valid =
    !!endpoints &&
    typeof endpoints === "object" &&
    !Array.isArray(endpoints) &&
    Object.values(endpoints).every((url) => typeof url === "string");
  if (!valid) sqlite.run("DELETE FROM settings WHERE key = ?", ENDPOINTS);
  else
    sqlite.run(
      "UPDATE settings SET value_json = ? WHERE key = ?",
      JSON.stringify(edit(endpoints as Record<string, string>)),
      ENDPOINTS,
    );
}

/** A database's schema as `sqlite_master` lists it (SQLite's own entries too: an autoindex, or a
 *  `sqlite_stat1` left by ANALYZE), whitespace aside: one text to compare. */
function schemaOf(sqlite: SqlDb) {
  const rows = sqlite
    .all("SELECT type, name, tbl_name, sql FROM sqlite_master")
    .map((r) => [
      r.type,
      r.name,
      r.tbl_name,
      typeof r.sql === "string" ? r.sql.replace(/\s+/g, " ").trim() : null,
    ]);
  return JSON.stringify(rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)));
}

const made = new WeakMap<SqlFiles, Array<{ tags: string[]; schema: string }>>();
/** The schema after each count of this app's migrations (one or more), made once in memory. */
function schemas(sql: SqlFiles) {
  let list = made.get(sql);
  if (!list) {
    list = migrations.map((_, i) => {
      const sqlite = sql.migrated(":memory:", i + 1);
      try {
        return { tags: migrations.slice(0, i + 1).map((m) => m.tag), schema: schemaOf(sqlite) };
      } finally {
        sqlite.close();
      }
    });
    made.set(sql, list);
  }
  return list;
}

/** The migrations a database has, by the exact schema they make and the tags it lists (undefined: not
 *  this app's database, or not sound); "newer" when it lists a migration this app does not know. */
function check(sql: SqlFiles, file: string): string[] | "newer" | undefined {
  const sqlite = sql.open(file, { readonly: true });
  try {
    // Nothing the schema names runs functions it may not, nor writes.
    sqlite.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON; PRAGMA cell_size_check = ON");
    const schema = schemaOf(sqlite);
    const matching = schemas(sql).filter((s) => s.schema === schema);
    if (!matching.length) return undefined;
    // This app's tables and indexes only, nothing else: now they may be read.
    const integrity = sqlite.all("PRAGMA integrity_check").map((r) => r.integrity_check);
    if (integrity.join() !== "ok" || sqlite.all("PRAGMA foreign_key_check").length)
      return undefined;
    const tags = sqlite.all("SELECT tag FROM _migrations ORDER BY rowid").map((r) => String(r.tag));
    if (tags.some((tag) => !migrations.some((m) => m.tag === tag))) return "newer";
    return matching.some((s) => JSON.stringify(s.tags) === JSON.stringify(tags)) ? tags : undefined;
  } finally {
    sqlite.close();
  }
}

/** The database checked, then migrated forward (the usual copy beside it first, 05 "Migrations"), its
 *  secrets emptied and only the endpoints of the providers in `endpoints` kept (the others' would
 *  not count). */
export function settleProfileDb(
  sql: SqlFiles,
  file: string,
  endpoints: readonly string[],
): Settled {
  let checked: ReturnType<typeof check>;
  try {
    checked = check(sql, file);
  } catch {
    // Not a database, or one SQLite cannot read.
    return "damaged";
  }
  if (checked === "newer") return "newer";
  if (!checked) return "damaged";
  let sqlite: SqlDb | undefined;
  try {
    sqlite = sql.migrated(file);
    sqlite.exec("DELETE FROM secrets");
    editEndpoints(sqlite, (set) =>
      Object.fromEntries(Object.entries(set).filter(([id]) => endpoints.includes(id))),
    );
    return schemaOf(sqlite) === schemas(sql).at(-1)?.schema ? "ok" : "damaged";
  } catch {
    return "damaged";
  } finally {
    sqlite?.close();
  }
}
