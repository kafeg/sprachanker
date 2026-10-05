import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Migration, MigrationError, migrate } from "../src/db/migrate.ts";
import { migrations } from "../src/db/profile/migrations/index.ts";
import { openProfileDb } from "../src/runtime/bun.ts";

const fresh = () => join(mkdtempSync(join(tmpdir(), "sprachanker-db-")), "profile.sqlite");

function runner(file: string) {
  const sqlite = new Database(file);
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
