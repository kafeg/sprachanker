import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backUpToday } from "../src/runtime/backup.ts";

test("a copy of every database a day, readable; a week's kept", () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-backup-"));
  mkdirSync(join(root, "profiles/local"), { recursive: true });
  for (const file of ["server.sqlite", "profiles/local/profile.sqlite"]) {
    const db = new Database(join(root, file));
    db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (x); INSERT INTO t VALUES (1);");
    db.close();
  }
  for (let d = 1; d <= 9; d++) backUpToday(root, new Date(2026, 9, d, 12));
  // The same day again makes no new copy.
  backUpToday(root, new Date(2026, 9, 9, 18));
  const copies = readdirSync(join(root, "profiles/local")).filter((f) => f.includes(".day-"));
  expect(copies.sort()).toEqual(
    [3, 4, 5, 6, 7, 8, 9].map((d) => `profile.sqlite.day-2026-10-0${d}`),
  );
  expect(readdirSync(root).filter((f) => f.includes(".day-"))).toHaveLength(7);
  const copy = new Database(join(root, "profiles/local/profile.sqlite.day-2026-10-09"));
  expect(copy.query("SELECT x FROM t").all()).toEqual([{ x: 1 }]);
});
