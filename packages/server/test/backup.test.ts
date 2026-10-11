import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backUpTo, backUpToday } from "../src/runtime/backup.ts";

test("a copy of every database a day, readable; a week's kept", () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-backup-"));
  mkdirSync(join(root, "profiles/local"), { recursive: true });
  for (const file of ["server.sqlite", "profiles/local/profile.sqlite"]) {
    const db = new Database(join(root, file));
    db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (x); INSERT INTO t VALUES (1);");
    db.close();
  }
  // A copy of an earlier day cut short (a full disk): gone with the next copy.
  writeFileSync(join(root, "server.sqlite.day-2026-09-30.part"), "half");
  for (let d = 1; d <= 9; d++) backUpToday(root, new Date(2026, 9, d, 12));
  // The same day again makes no new copy.
  backUpToday(root, new Date(2026, 9, 9, 18));
  const copies = readdirSync(join(root, "profiles/local")).filter((f) => f.includes(".day-"));
  expect(copies.sort()).toEqual(
    [3, 4, 5, 6, 7, 8, 9].map((d) => `profile.sqlite.day-2026-10-0${d}`),
  );
  expect(readdirSync(root).filter((f) => f.includes(".day-"))).toHaveLength(7);
  expect(readdirSync(root).filter((f) => f.endsWith(".part"))).toEqual([]);
  const copy = new Database(join(root, "profiles/local/profile.sqlite.day-2026-10-09"));
  expect(copy.query("SELECT x FROM t").all()).toEqual([{ x: 1 }]);
});

test("a backup on request: the databases, recordings, imported decks and the key, in a folder of its own", () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-backup-"));
  mkdirSync(join(root, "profiles/local/recordings"), { recursive: true });
  for (const file of ["server.sqlite", "profiles/local/profile.sqlite"]) {
    const db = new Database(join(root, file));
    db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (x); INSERT INTO t VALUES (1);");
    db.close();
  }
  writeFileSync(join(root, "profiles/local/recordings/01K00000000000000000000000.webm"), "take");
  writeFileSync(join(root, "profiles/local/profile.sqlite.day-2026-10-01"), "a day's copy");
  mkdirSync(join(root, "profiles/.transfers/x"), { recursive: true });
  mkdirSync(join(root, "decks/my-deck/media"), { recursive: true });
  writeFileSync(join(root, "decks/my-deck/deck.json"), "{}");
  mkdirSync(join(root, "decks/.uploads"), { recursive: true });
  writeFileSync(join(root, "decks/.uploads/u.apkg"), "upload");
  mkdirSync(join(root, "library/x"), { recursive: true });
  const key = join(root, "app-data-secret.key");
  writeFileSync(key, new Uint8Array(32));
  const to = mkdtempSync(join(tmpdir(), "sprachanker-backups-"));
  // One an earlier run left half-made: it goes.
  mkdirSync(join(to, "sprachanker-backup-20261010-120000.part/profiles"), { recursive: true });
  const { folder } = backUpTo(root, to, key, new Date("2026-10-11T08:30:05Z"));
  expect(folder).toBe(join(to, "sprachanker-backup-20261011-083005"));
  expect(readdirSync(to)).toEqual(["sprachanker-backup-20261011-083005"]);
  // Its owner's only: it holds the key.
  expect(statSync(folder).mode & 0o777).toBe(0o700);
  expect(readdirSync(folder).sort()).toEqual([
    "app-data-secret.key",
    "decks",
    "profiles",
    "server.sqlite",
  ]);
  expect(readdirSync(join(folder, "profiles"))).toEqual(["local"]);
  expect(readdirSync(join(folder, "profiles/local")).sort()).toEqual([
    "profile.sqlite",
    "recordings",
  ]);
  expect(readdirSync(join(folder, "decks"))).toEqual(["my-deck"]);
  const copy = new Database(join(folder, "profiles/local/profile.sqlite"));
  expect(copy.query("SELECT x FROM t").all()).toEqual([{ x: 1 }]);
  // The same second again: refused, the first left as it was.
  expect(() => backUpTo(root, to, key, new Date("2026-10-11T08:30:05Z"))).toThrow(/exists/);
  // Never into the data folder it copies (by any path to it), nor a folder in it not made yet.
  for (const inside of [root, join(root, "backups"), join(root, "profiles/../backups/new")])
    expect(() => backUpTo(root, inside, key)).toThrow(/inside the data folder/);
  const link = join(to, "link-to-data");
  symlinkSync(root, link);
  expect(() => backUpTo(root, join(link, "b"), key)).toThrow(/inside the data folder/);
  expect(existsSync(join(root, "backups"))).toBe(false);
});
