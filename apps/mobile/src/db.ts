// The server's SQLite databases on the phone: sql.js (SQLite in WebAssembly) in the page's memory,
// read from the app's files at the start, migrated as on the Mac (the server's migrate.ts), and
// written back whole a moment after a change (and when the app goes to the background). A change
// made in the last second before the app is killed can be lost.
import { type Migration, migrate } from "@sprachanker/server/portable";
import initSqlJs, { type Database } from "sql.js";
import type { Files } from "./files.ts";

/** sql.js, loaded once when the first database opens (no top-level await: the app's start must
 *  replace `fetch` before the web app runs). */
let loaded: ReturnType<typeof initSqlJs> | undefined;
/** Where sql.js's WebAssembly is: beside the page (tests give the package's file). */
let wasm = "/sql-wasm.wasm";
export const sqlJsWasmAt = (path: string) => {
  wasm = path;
};
const sqlJs = () => {
  loaded ??= initSqlJs({ locateFile: () => wasm });
  return loaded;
};
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

/** How soon after a change the database is written. */
const WRITE_AFTER_MS = 300;

/** A transaction begun inside another (the run store's own inside a service's — Bun's SQLite nests
 *  them itself) made a savepoint: drizzle's sql.js session sends a plain `begin`, `commit`,
 *  `rollback` for each. */
function nesting(db: Database) {
  const prepare = db.prepare.bind(db);
  let depth = 0;
  db.prepare = (sql, params) => {
    const word = sql.trim().toLowerCase();
    if (/^begin\b/.test(word)) {
      depth++;
      if (depth > 1) return prepare(`SAVEPOINT nest${depth}`, params);
    } else if (word === "commit" && depth > 0) {
      depth--;
      if (depth > 0) return prepare(`RELEASE nest${depth + 1}`, params);
    } else if (word === "rollback" && depth > 0) {
      depth--;
      if (depth > 0) return prepare(`ROLLBACK TO nest${depth + 1}`, params);
    }
    return prepare(sql, params);
  };
  return db;
}

const pragmas = (db: Database) => db.exec("PRAGMA foreign_keys = ON;");
const one = (db: Database, sql: string) => db.exec(sql)[0]?.values ?? [];

const open = new Set<() => Promise<void>>();
/** Every open database written now (the app going to the background). */
export const flushAll = () => Promise.all([...open].map((f) => f()));

/** A database file (relative to the data root) opened — read first — and migrated. */
export async function openDb(files: Files, rel: string, migrations: Migration[]) {
  SQL = await sqlJs();
  const bytes = files.has(rel) ? await files.read(rel) : undefined;
  return makeDb(files, rel, migrations, bytes);
}

/** A database made from its bytes (none: a new one) and migrated, synchronously; written to `rel`
 *  a moment after each change (a new or migrated one at once): sql.js's handle, and how to let it go
 *  (written first). */
export function makeDb(files: Files, rel: string, migrations: Migration[], bytes?: Uint8Array) {
  const db = nesting(new SQL.Database(bytes));
  pragmas(db);
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const name = rel.slice(dir ? dir.length + 1 : 0);
  migrate(
    {
      exec: (sql) => db.exec(sql),
      tags: () => one(db, "SELECT tag FROM _migrations").map((r) => String(r[0])),
      backup: (target) => {
        void files.write(target, db.export());
        pragmas(db);
      },
      transaction(fn) {
        db.exec("BEGIN");
        try {
          fn();
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      foreignKeyViolations: () => one(db, "PRAGMA foreign_key_check").length,
    },
    migrations,
    {
      file: rel,
      now: Date.now(),
      listBackups: () =>
        files.fs
          .files(files.abs(dir))
          .filter((f) => f.startsWith(`${name}.bak-`))
          .map((f) => (dir ? `${dir}/${f}` : f)),
      remove: (f) => void files.remove(f),
    },
  );

  // Written a moment after a change: `total_changes()` counts them (from 0 again once exported —
  // sql.js's export reopens the database, and its pragmas with it).
  let seen = 0;
  let writing = Promise.resolve();
  const changes = () => Number(one(db, "SELECT total_changes()")[0]?.[0] ?? 0);
  const write = () => {
    writing = writing.then(async () => {
      if (changes() === seen) return;
      const bytes = db.export();
      pragmas(db);
      seen = 0;
      // A write that fails is tried again at the next tick (the chain itself never fails).
      try {
        await files.write(rel, bytes);
      } catch (error) {
        seen = -1;
        console.error(`${rel} not written: ${error}`);
      }
    });
    return writing;
  };
  // A new database (or one just migrated) is written at once.
  if (!bytes || changes() > 0) {
    seen = -1;
    void write();
  }
  const timer = setInterval(() => {
    if (changes() !== seen) void write();
  }, WRITE_AFTER_MS);
  open.add(write);
  return {
    db,
    async close() {
      clearInterval(timer);
      await write();
      open.delete(write);
      db.close();
    },
  };
}
