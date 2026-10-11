// Bun-specific adapters. Everything else in the server stays runtime-agnostic (Node fallback).
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { writeFileAtomic } from "@sprachanker/course-kit";
import { PROFILE_FILE_MAX_BYTES } from "@sprachanker/schema";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { type Migration, migrate } from "../db/migrate.ts";
import type { ProfileDb } from "../db/profile/db.ts";
import { migrations } from "../db/profile/migrations/index.ts";
import * as schema from "../db/profile/schema.ts";
import type { ServerDb } from "../db/server/db.ts";
import { migrations as serverMigrations } from "../db/server/migrations/index.ts";
import * as serverSchema from "../db/server/schema.ts";
import type { MediaBlob } from "../media.ts";
import { DECK_MAX_BYTES } from "../services/decks.ts";
import type { ProfileFiles, RecordingFiles } from "../services/profiles.ts";
import type { WebAssets } from "../web.ts";

/** The routes that answer only once a file is read or written: a deck package's (routes/decks.ts), a
 *  profile file's (routes/profiles.ts). */
const UNTIMED = /^\/api\/(decks\/(preview|import)|profiles\/import|profile\/export\/[^/]+)$/;

export interface Listening {
  url: string;
  stop(): Promise<void>;
}

export function listen(
  fetch: (request: Request) => Response | Promise<Response>,
  options: { hostname: string; port: number },
): Listening {
  const server = Bun.serve({
    fetch(request, bun) {
      // A deck file's preview and import, a profile file's import and download read or write for
      // minutes: they wait as long as they take; every other request up to `idleTimeout` (a model's
      // first words, 07).
      if (UNTIMED.test(new URL(request.url).pathname)) bun.timeout(request, 0);
      return fetch(request);
    },
    hostname: options.hostname,
    port: options.port,
    // Bun's most: a local model may take minutes to its first token (07: 180 s), a speech engine to
    // load; Bun's default 10 s would cut them.
    idleTimeout: 255,
    // A profile file is the largest body taken (Bun's own limit is 128 MB); each route keeps its own
    // limit below it (app.ts).
    maxRequestBodySize: Math.max(DECK_MAX_BYTES, PROFILE_FILE_MAX_BYTES) + 1024 * 1024,
  });
  return { url: server.url.href, stop: () => server.stop() };
}

/** Web assets read from a directory on disk; paths outside it are never served. */
export function directoryAssets(dir: string): WebAssets {
  const root = resolve(dir);
  return async (path) => {
    const full = resolve(root, `.${path}`);
    if (!full.startsWith(root + sep) || !statSync(full, { throwIfNoEntry: false })?.isFile()) {
      return undefined;
    }
    return Bun.file(full);
  };
}

/** Web assets from a URL path → file path map (files embedded in the compiled binary). */
export function fileAssets(files: Record<string, string>): WebAssets {
  return async (path) => {
    const file = files[path];
    return file === undefined ? undefined : Bun.file(file);
  };
}

/** A profile's database file under the data root. */
export const profileDbFile = (dataRoot: string, id: string) =>
  join(dataRoot, "profiles", id, "profile.sqlite");

/** The migrations a profile database may have: this app's, in order. */
export const profileMigrationTags = migrations.map((m) => m.tag);

/** A profile database opened (created if needed) in WAL mode with pending migrations applied: the
 *  SQLite handle itself (a profile file's import checks it). */
export const openProfileSqlite = (file: string, now = Date.now()) =>
  openSqlite(file, migrations, now);

/** Opens (creating if needed) a profile database in WAL mode and applies pending migrations; `close`
 *  lets it go. */
function openProfile(file: string, now: number) {
  const sqlite = openProfileSqlite(file, now);
  return { db: drizzle(sqlite, { schema }) as ProfileDb, close: () => sqlite.close() };
}
export const openProfileDb = (file: string, now = Date.now()): ProfileDb =>
  openProfile(file, now).db;

/** Opens (creating if needed) the server database (profiles, devices). */
export const openServerDb = (file: string, now = Date.now()): ServerDb =>
  drizzle(openSqlite(file, serverMigrations, now), { schema: serverSchema });

/** The profiles' folders under the data root: profiles/<id>/profile.sqlite, opened once (one
 *  connection per profile) and closed when the profile is removed. */
export function profileFiles(dataRoot: string): ProfileFiles {
  const folder = (id: string) => join(dataRoot, "profiles", id);
  const opened = new Map<string, ReturnType<typeof openProfile>>();
  return {
    exists: (id) => statSync(profileDbFile(dataRoot, id), { throwIfNoEntry: false }) !== undefined,
    open(id) {
      let entry = opened.get(id);
      if (!entry) {
        entry = openProfile(profileDbFile(dataRoot, id), Date.now());
        opened.set(id, entry);
      }
      return entry.db;
    },
    remove(id) {
      opened.get(id)?.close();
      opened.delete(id);
      rmSync(folder(id), { recursive: true, force: true });
    },
    recordings: (id) => recordingFiles(join(folder(id), "recordings")),
  };
}

/** A recordings folder; names are checked by the service (`<ulid>.<ext>`), kept to the folder here too. */
function recordingFiles(dir: string): RecordingFiles {
  const file = (name: string) => {
    if (basename(name) !== name) throw new Error(`bad recording name ${name}`);
    return join(dir, name);
  };
  return {
    // Whole or not at all: a take cut short (the server stopped) is never served as one.
    write: (name, bytes) => writeFileAtomic(file(name), bytes),
    read: (name) =>
      statSync(file(name), { throwIfNoEntry: false })?.isFile() ? Bun.file(file(name)) : undefined,
    list: () =>
      (statSync(dir, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(dir) : []).map(
        (name) => ({ name, size: statSync(join(dir, name)).size }),
      ),
    remove(names) {
      for (const name of names) rmSync(file(name), { force: true });
    },
  };
}

/** How long a statement waits for another connection's write before it fails (SQLITE_BUSY). */
export const BUSY_MS = 5000;

/** A whole copy of the database written to `target` (a backup before migrating, a daily copy). */
export const vacuumInto = (sqlite: Database, target: string) =>
  sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

/** A SQLite file in WAL mode with its migrations applied (backed up first, 05). */
function openSqlite(file: string, list: Migration[], now: number) {
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file, { create: true, strict: true });
  // Another connection writing (the command line beside a server, a daily copy) is waited for, not
  // failed at once.
  sqlite.exec(
    `PRAGMA busy_timeout = ${BUSY_MS}; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`,
  );
  migrate(
    {
      exec: (sql) => sqlite.exec(sql),
      tags: () =>
        sqlite
          .query<{ tag: string }, []>("SELECT tag FROM _migrations")
          .all()
          .map((r) => r.tag),
      backup: (target) => vacuumInto(sqlite, target),
      transaction: (fn) => sqlite.transaction(fn)(),
      foreignKeyViolations: () => sqlite.query("PRAGMA foreign_key_check").all().length,
    },
    list,
    {
      file,
      now,
      listBackups: () =>
        readdirSync(dirname(file))
          .filter((f) => f.startsWith(`${basename(file)}.bak-`))
          .map((f) => join(dirname(file), f)),
      remove: (f) => rmSync(f),
    },
  );
  return sqlite;
}

/** A library media file as a Blob (type from the extension). */
export const mediaBlob = (file: string): MediaBlob => Bun.file(file);

/** The key that seals secrets: read from `file`, created (owner-only) on first use. */
export function secretKey(file: string): Uint8Array {
  if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
    const key = new Uint8Array(readFileSync(file));
    if (key.length === 32) return key;
    throw new Error(`${file}: expected a 32-byte key`);
  }
  mkdirSync(dirname(file), { recursive: true });
  const key = crypto.getRandomValues(new Uint8Array(32));
  writeFileSync(file, key, { mode: 0o600, flag: "wx" });
  return key;
}
