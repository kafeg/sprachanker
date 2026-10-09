import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { type Migration, MigrationError, migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/profile/migrations/index.ts";
import { migrations as serverMigrations } from "../src/db/server/migrations/index.ts";
import { BUSY_MS, openProfileDb } from "../src/runtime/bun.ts";

const fresh = () => join(mkdtempSync(join(tmpdir(), "sprachanker-db-")), "profile.sqlite");

function runner(file: string) {
  const sqlite = new Database(file);
  // As the app opens a profile (runtime/bun.ts).
  sqlite.exec("PRAGMA foreign_keys = ON");
  return {
    sqlite,
    db: {
      exec: (sql: string) => sqlite.exec(sql),
      tags: () =>
        sqlite
          .query<{ tag: string }, []>("SELECT tag FROM _migrations")
          .all()
          .map((r) => r.tag),
      backup: (target: string) => sqlite.exec(`VACUUM INTO '${target}'`),
      transaction: (fn: () => void) => sqlite.transaction(fn)(),
      foreignKeyViolations: () => sqlite.query("PRAGMA foreign_key_check").all().length,
    },
    options: (now: number) => ({
      file,
      now,
      listBackups: () =>
        readdirSync(join(file, ".."))
          .filter((f) => f.includes(".bak-"))
          .map((f) => join(file, "..", f)),
      remove: () => {},
    }),
  };
}
const tables = (file: string) =>
  new Database(file)
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);

test("a new profile database gets every table; reopening changes nothing", () => {
  const file = fresh();
  openProfileDb(file, 1);
  expect(tables(file)).toEqual([
    "_migrations",
    "card_state",
    "cards",
    "events",
    "llm_routes",
    "runs",
    "secrets",
    "settings",
  ]);
  openProfileDb(file, 2);
  expect(readdirSync(join(file, "..")).some((f) => f.includes(".bak-"))).toBe(false);
});

test("pending migrations on an existing database are applied after a backup", () => {
  const file = fresh();
  openProfileDb(file, 1);
  const { db, options } = runner(file);
  const next: Migration[] = [
    ...migrations,
    { tag: "0001_note", sql: "ALTER TABLE runs ADD note TEXT;" },
  ];
  expect(migrate(db, next, options(5))).toEqual(["0001_note"]);
  expect(existsSync(`${file}.bak-5`)).toBe(true);
});

test("a migration may rebuild a table others refer to; a reference left dangling fails it", () => {
  const file = fresh();
  openProfileDb(file, 1);
  const { db, options, sqlite } = runner(file);
  sqlite.exec(
    "INSERT INTO runs (id, kind, app_version, status, started_at) VALUES ('r1', 'lesson', 't', 'active', 1);" +
      "INSERT INTO events (id, run_id, ts, type, payload_json) VALUES ('e1', 'r1', 1, 'step_done', '{}');",
  );
  // drizzle-kit's table rebuild: create a copy, move the rows, drop the old table, rename.
  const ddl =
    sqlite.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE name = 'runs'").get()
      ?.sql ?? "";
  const rebuild = (tag: string, rows: string): Migration => ({
    tag,
    sql: [
      ddl.replace(/CREATE TABLE [`"]?runs[`"]?/, "CREATE TABLE `__new_runs`"),
      `INSERT INTO __new_runs SELECT * FROM runs ${rows}`,
      "DROP TABLE runs",
      "ALTER TABLE __new_runs RENAME TO runs",
    ].join(";--> statement-breakpoint\n"),
  });
  expect(migrate(db, [...migrations, rebuild("0901_rebuild", "")], options(5))).toEqual([
    "0901_rebuild",
  ]);
  expect(sqlite.query("SELECT id FROM events").all()).toEqual([{ id: "e1" }]);
  // A rebuild that loses the run its event belongs to is rolled back.
  expect(() =>
    migrate(
      db,
      [...migrations, rebuild("0901_rebuild", ""), rebuild("0902_lose", "WHERE 0")],
      options(6),
    ),
  ).toThrow(/0902_lose failed.*a foreign key no longer resolves/);
  expect(sqlite.query("SELECT id FROM runs").all()).toEqual([{ id: "r1" }]);
  expect(
    sqlite.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys,
  ).toBe(1);
});

test("a database from a newer version is refused", () => {
  const file = fresh();
  openProfileDb(file, 1);
  const { db, options } = runner(file);
  expect(() => migrate(db, [], options(3))).toThrow(MigrationError);
});

test("a failing migration is rolled back and reported", () => {
  const file = fresh();
  openProfileDb(file, 1);
  const { db, options } = runner(file);
  const broken: Migration[] = [
    ...migrations,
    {
      tag: "0001_broken",
      sql: "CREATE TABLE x (a);--> statement-breakpoint\nSELECT nope FROM nowhere;",
    },
  ];
  expect(() => migrate(db, broken, options(4))).toThrow(/0001_broken failed/);
  expect(tables(file)).not.toContain("x");
});

test("cards: a card's run, once deleted, leaves it without one; a lexeme has one card per translation language", () => {
  const file = fresh();
  const { db, options, sqlite } = runner(file);
  migrate(db, migrations, options(1));
  const add = (id: string, lang: string, run = "NULL") =>
    sqlite.exec(
      `INSERT INTO cards (id, kind, lexeme_key, translation_lang, faces, created_at, origin_run_id) VALUES ('${id}', 'lexeme', 'lex:de:a:word', '${lang}', 'recognition', 1, ${run});`,
    );
  sqlite.exec(
    "INSERT INTO runs (id, kind, app_version, status, started_at) VALUES ('r1', 'lesson', 't', 'active', 1);",
  );
  add("c1", "ru", "'r1'");
  add("c2", "en");
  expect(() => add("c3", "ru")).toThrow(/UNIQUE/);
  sqlite.exec("DELETE FROM runs WHERE id = 'r1'");
  expect(sqlite.query("SELECT origin_run_id FROM cards WHERE id = 'c1'").get()).toEqual({
    origin_run_id: null,
  });
});

test("server.sqlite without passkeys: a database with one upgrades, its profiles and devices kept", () => {
  const file = join(mkdtempSync(join(tmpdir(), "sprachanker-db-")), "server.sqlite");
  const { db, sqlite, options } = runner(file);
  migrate(db, serverMigrations.slice(0, 1), options(1));
  sqlite.exec(
    "INSERT INTO profiles (id, name, colour, created_at) VALUES ('local', 'Anna', 'amber', 1)",
  );
  sqlite.exec(
    "INSERT INTO passkeys (id, profile_id, public_key, counter, transports, rp_id, created_at) VALUES ('k', 'local', 'pk', 0, '', 'localhost', 1)",
  );
  expect(migrate(db, serverMigrations.slice(0, 2), options(2))).toEqual(["0001_drop_passkeys"]);
  expect(tables(file)).not.toContain("passkeys");
  expect(sqlite.query("SELECT name FROM profiles").all()).toEqual([{ name: "Anna" }]);
});

test("server.sqlite without PINs: a profile with one and its device are kept, the PIN is gone", () => {
  const file = join(mkdtempSync(join(tmpdir(), "sprachanker-db-")), "server.sqlite");
  const { db, sqlite, options } = runner(file);
  migrate(db, serverMigrations.slice(0, 2), options(1));
  sqlite.exec(
    "INSERT INTO profiles (id, name, colour, pin_hash, pin_salt, failed_pins, created_at) VALUES ('local', 'Anna', 'amber', 'h', 's', 3, 1)",
  );
  sqlite.exec(
    "INSERT INTO devices (id, profile_id, token_hash, user_agent, created_at, last_seen_at) VALUES ('d', 'local', 't', 'Mac', 1, 1)",
  );
  expect(migrate(db, serverMigrations, options(2))).toEqual(["0002_drop_pins"]);
  expect(sqlite.query("SELECT * FROM profiles").all()).toEqual([
    { id: "local", name: "Anna", colour: "amber", onboarded: 0, created_at: 1 },
  ]);
  expect(sqlite.query("SELECT id FROM devices").all()).toEqual([{ id: "d" }]);
});

test("a database waits for another connection's write instead of failing at once", () => {
  const dir = mkdtempSync(join(tmpdir(), "sprachanker-busy-"));
  const db = openProfileDb(join(dir, "profile.sqlite"));
  expect(db.all(sql`PRAGMA busy_timeout`)).toEqual([{ timeout: BUSY_MS }]);
});
