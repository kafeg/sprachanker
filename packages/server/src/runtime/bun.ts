// Bun-specific adapters. Everything else in the server stays runtime-agnostic (Node fallback).
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "../db/migrate.ts";
import type { ProfileDb } from "../db/profile/db.ts";
import { migrations } from "../db/profile/migrations/index.ts";
import * as schema from "../db/profile/schema.ts";
import type { MediaBlob } from "../media.ts";
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
export function openProfileDb(file: string, now = Date.now()): ProfileDb {
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
    migrations,
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
  return drizzle(sqlite, { schema });
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
