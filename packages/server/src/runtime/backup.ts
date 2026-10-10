// A copy of each database a day (05, "Backups"): server.sqlite and every profile's, made with
// `VACUUM INTO` beside the file as `<file>.day-<date>` when the server starts and then every few hours
// for a day that has none; the last week's kept. A bad migration or a wrong reset loses a day at most.
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { BUSY_MS, profileDbFile, vacuumInto } from "./bun.ts";

const DAYS_KEPT = 7;
const EVERY_MS = 6 * 3_600_000;

/** The data root's databases: the server's and each profile's. */
function databases(dataRoot: string) {
  const profiles = join(dataRoot, "profiles");
  return [
    join(dataRoot, "server.sqlite"),
    ...(existsSync(profiles) ? readdirSync(profiles) : []).map((id) => profileDbFile(dataRoot, id)),
  ].filter((file) => existsSync(file));
}

/** Today's copy of every database that has none yet, and the oldest beyond a week removed. */
export function backUpToday(dataRoot: string, now: Date) {
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
  for (const file of databases(dataRoot)) {
    try {
      const copy = `${file}.day-${day}`;
      if (!existsSync(copy)) {
        // Written aside and renamed when whole: a copy cut short (a crash, a full disk) never
        // stands in for the day's.
        const part = `${copy}.part`;
        rmSync(part, { force: true });
        const db = new Database(file);
        try {
          db.exec(`PRAGMA busy_timeout = ${BUSY_MS}`);
          vacuumInto(db, part);
        } finally {
          db.close();
        }
        renameSync(part, copy);
      }
      const prefix = `${basename(file)}.day-`;
      const named = readdirSync(dirname(file)).filter((f) => f.startsWith(prefix));
      const copies = named.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.slice(prefix.length))).sort();
      for (const old of copies.slice(0, -DAYS_KEPT)) rmSync(join(dirname(file), old));
      // A copy of an earlier day cut short (the copy is made here, one at a time: none is being made).
      for (const part of named.filter((f) => f.endsWith(".part")))
        rmSync(join(dirname(file), part));
    } catch (error) {
      console.error(`backing up ${file}:`, error);
    }
  }
}

/** Backs up now and then every few hours while the server runs. */
export function startDailyBackups(dataRoot: string) {
  backUpToday(dataRoot, new Date());
  setInterval(() => backUpToday(dataRoot, new Date()), EVERY_MS).unref();
}
