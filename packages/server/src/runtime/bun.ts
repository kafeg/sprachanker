// Bun-specific adapters. Everything else in the server stays runtime-agnostic (Node fallback).
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { type Migration, migrate } from "../db/migrate.ts";
import type { ProfileDb } from "../db/profile/db.ts";
import { migrations } from "../db/profile/migrations/index.ts";
import * as schema from "../db/profile/schema.ts";
import type { ServerDb } from "../db/server/db.ts";
import { migrations as serverMigrations } from "../db/server/migrations/index.ts";
import * as serverSchema from "../db/server/schema.ts";
import type { MediaBlob } from "../media.ts";
import type { ProfileFiles, RecordingFiles } from "../services/profiles.ts";
import type { WebAssets } from "../web.ts";

export interface Listening {
  url: string;
  stop(): Promise<void>;
}

export function listen(
  fetch: (request: Request) => Response | Promise<Response>,
  options: { hostname: string; port: number },
): Listening {
  const server = Bun.serve({ fetch, hostname: options.hostname, port: options.port });
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

/** Opens (creating if needed) a profile database in WAL mode and applies pending migrations. */
export const openProfileDb = (file: string, now = Date.now()): ProfileDb =>
  drizzle(openSqlite(file, migrations, now), { schema });

/** Opens (creating if needed) the server database (profiles, devices). */
export const openServerDb = (file: string, now = Date.now()): ServerDb =>
  drizzle(openSqlite(file, serverMigrations, now), { schema: serverSchema });

/** The profiles' folders under the data root: profiles/<id>/profile.sqlite, opened on first use. */
export function profileFiles(dataRoot: string): ProfileFiles {
  const folder = (id: string) => join(dataRoot, "profiles", id);
  return {
    exists: (id) =>
      statSync(join(folder(id), "profile.sqlite"), { throwIfNoEntry: false }) !== undefined,
    open: (id) => openProfileDb(join(folder(id), "profile.sqlite")),
    remove: (id) => rmSync(folder(id), { recursive: true, force: true }),
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
    async write(name, bytes) {
      mkdirSync(dir, { recursive: true });
      await Bun.write(file(name), bytes);
    },
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

/** A SQLite file in WAL mode with its migrations applied (backed up first, 05). */
function openSqlite(file: string, list: Migration[], now: number) {
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(
    {
      exec: (sql) => sqlite.exec(sql),
      tags: () =>
        sqlite
          .query<{ tag: string }, []>("SELECT tag FROM _migrations")
          .all()
          .map((r) => r.tag),
      backup: (target) => sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`),
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
