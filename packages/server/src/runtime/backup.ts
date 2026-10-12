// A copy of each database a day (05, "Backups"): server.sqlite and every profile's, made with
// `VACUUM INTO` beside the file as `<file>.day-<date>` when the server starts and then every few hours
// for a day that has none; the last week's kept. A bad migration or a wrong reset loses a day at most.
// And a backup on request (`sprachanker backup`, 06): what cannot be fetched again, copied whole into
// a folder of its own.
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { BUSY_MS, profileDbFile, vacuumInto } from "./bun.ts";

const DAYS_KEPT = 7;
const EVERY_MS = 6 * 3_600_000;
/** A backup being written (`backUpTo`). */
const BACKUP_PART = /^sprachanker-backup-\d{8}-\d{6}\.part$/;

/** A path with its links followed as far as it exists (a folder not made yet: its parent's). */
function realPath(path: string): string {
  const full = resolve(path);
  if (existsSync(full)) return realpathSync(full);
  const parent = dirname(full);
  return parent === full ? full : join(realPath(parent), basename(full));
}

/** The profiles' folders (a dot folder is no profile: `.transfers`, 05). */
const profileIds = (dataRoot: string) => {
  const profiles = join(dataRoot, "profiles");
  return (existsSync(profiles) ? readdirSync(profiles) : []).filter((id) => !id.startsWith("."));
};

/** The data root's databases: the server's and each profile's. */
function databases(dataRoot: string) {
  return [
    join(dataRoot, "server.sqlite"),
    ...profileIds(dataRoot).map((id) => profileDbFile(dataRoot, id)),
  ].filter((file) => existsSync(file));
}

/** A database copied whole with `VACUUM INTO` (consistent while a server writes to it). */
function copyDatabase(file: string, target: string) {
  const db = new Database(file, { readwrite: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_MS}`);
    vacuumInto(db, target);
  } finally {
    db.close();
  }
}

/** The bytes of a file, or of a folder's files. */
function bytesOf(path: string): number {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((n, name) => n + bytesOf(join(path, name)), 0);
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
        copyDatabase(file, part);
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

/**
 * A backup of what cannot be fetched again (05, "Backups") in a new folder in `to`
 * (`sprachanker-backup-<date>-<time>`, local time, written as `….part` and renamed when whole):
 * server.sqlite and
 * each profile's database (`VACUUM INTO`: consistent while a server runs), the profiles' recordings,
 * the imported decks, and `secretKey` (the stored API keys are sealed with it). The folder is its
 * owner's only (0700); never inside the data root; half-made ones an earlier run left there go; the
 * disk of `to` is checked for room first. Each copy is consistent, but they are taken one after
 * another: a profile or recording changed meanwhile may be a moment apart from the rest. Returns the
 * folder and its size.
 */
export function backUpTo(dataRoot: string, to: string, secretKey: string, now = new Date()) {
  const within = relative(realPath(dataRoot), realPath(to));
  if (!within.startsWith("..") && !isAbsolute(within))
    throw new Error(
      `${to} is inside the data folder ${dataRoot}: back it up to a folder outside it`,
    );
  // The computer's own time, as its clock shows it (not UTC).
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const folder = join(to, `sprachanker-backup-${stamp}`);
  if (existsSync(folder)) throw new Error(`${folder} exists`);
  const ids = profileIds(dataRoot);
  const decks = join(dataRoot, "decks");
  const deckFolders = (existsSync(decks) ? readdirSync(decks) : []).filter(
    (name) => !name.startsWith("."),
  );
  const recordings = (id: string) => join(dataRoot, "profiles", id, "recordings");
  const bytes =
    databases(dataRoot).reduce((n, f) => n + bytesOf(f) + bytesOf(`${f}-wal`), 0) +
    ids.reduce((n, id) => n + bytesOf(recordings(id)), 0) +
    deckFolders.reduce((n, d) => n + bytesOf(join(decks, d)), 0);
  mkdirSync(to, { recursive: true });
  // Backups an earlier run left half-made (stopped, the disk full): never whole, they only take room.
  for (const name of readdirSync(to))
    if (BACKUP_PART.test(name)) rmSync(join(to, name), { recursive: true, force: true });
  const disk = statfsSync(to);
  const free = disk.bavail * disk.bsize;
  if (free < bytes + 16 * 1024 * 1024)
    throw new Error(
      `not enough free space in ${to}: about ${Math.ceil(bytes / 1e6)} MB needed, ${Math.floor(free / 1e6)} MB free`,
    );
  const part = `${folder}.part`;
  rmSync(part, { recursive: true, force: true });
  // Its owner's only: it holds the key the API keys are sealed with, and everyone's learning.
  mkdirSync(part, { mode: 0o700 });
  try {
    for (const file of databases(dataRoot)) {
      const target = join(part, relative(dataRoot, file));
      mkdirSync(dirname(target), { recursive: true });
      copyDatabase(file, target);
    }
    for (const id of ids)
      if (existsSync(recordings(id)))
        cpSync(recordings(id), join(part, "profiles", id, "recordings"), { recursive: true });
    for (const d of deckFolders)
      cpSync(join(decks, d), join(part, "decks", d), { recursive: true });
    if (existsSync(secretKey)) copyFileSync(secretKey, join(part, basename(secretKey)));
    renameSync(part, folder);
  } catch (error) {
    rmSync(part, { recursive: true, force: true });
    throw error;
  }
  return { folder, bytes: bytesOf(folder) };
}
