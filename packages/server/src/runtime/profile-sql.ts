// Bun's SQLite for profile files (storage/profile-transfer.ts): the live database copied with `VACUUM
// INTO`, a copy opened to be changed, a received one made ready in a Worker (profile-db-worker.ts:
// its checks and migrations take minutes on a large file and never hold up the server's requests).
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { migrations } from "../db/profile/migrations/index.ts";
import type { Settled, SqlDb, SqlFiles } from "../storage/profile-db.ts";
import type { ProfileSql } from "../storage/profile-transfer.ts";
import { BUSY_MS, openProfileSqlite, profileDbFile, vacuumInto } from "./bun.ts";

/** The Worker that makes an imported profile's database ready, from sources; the compiled binary names
 *  its own (apps/cli/scripts/build.ts adds it as an entry). */
export const PROFILE_DB_WORKER = join(import.meta.dir, "profile-db-worker.ts");

const sqlDb = (sqlite: Database): SqlDb => ({
  exec: (sql) => sqlite.exec(sql),
  all: (sql, ...params) =>
    sqlite.query(sql).all(...(params as [])) as Array<Record<string, unknown>>,
  run: (sql, ...params) => void sqlite.run(sql, params as []),
  close: () => sqlite.close(),
});

export const bunSqlFiles: SqlFiles = {
  open: (file, options = {}) =>
    sqlDb(options.readonly ? new Database(file, { readonly: true }) : new Database(file)),
  migrated: (file, upTo) => sqlDb(openProfileSqlite(file, Date.now(), upTo)),
};

export function bunProfileSql(
  dataRoot: string,
  options: {
    /** The Worker of profile-db-worker.ts: the compiled binary's own. */ worker?: string;
  },
): ProfileSql {
  return {
    migrations: migrations.map((m) => m.tag),
    copy(profileId, file) {
      const live = new Database(profileDbFile(dataRoot, profileId), { readwrite: true });
      try {
        live.exec(`PRAGMA busy_timeout = ${BUSY_MS}`);
        vacuumInto(live, file);
      } finally {
        live.close();
      }
    },
    open: (file) => bunSqlFiles.open(file),
    settle(file, endpoints, ms) {
      const worker = new Worker(options.worker ?? PROFILE_DB_WORKER);
      return new Promise<Settled>((resolve) => {
        const done = (settled: Settled) => {
          clearTimeout(timer);
          // A worker held inside SQLite itself is not stopped by this; nothing of the file's own SQL
          // runs there (profile-db.ts), so only a fault of SQLite's could hold it.
          void worker.terminate();
          resolve(settled);
        };
        const timer = setTimeout(() => done("damaged"), ms);
        worker.onmessage = (event: MessageEvent<Settled>) => done(event.data);
        worker.onerror = () => done("damaged");
        worker.postMessage({ file, endpoints });
      });
    },
  };
}
