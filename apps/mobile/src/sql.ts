// sql.js for what the server's storage asks of SQLite beside the open databases (db.ts): an .apkg's
// database from its bytes (with zstd: fzstd), a profile file's database copied, opened and made ready
// — the server's profile-db.ts run over it here, in the page, as the desktop runs it in a Worker.
import { type DataFs, dirName } from "@sprachanker/course-kit";
import {
  type ApkgRuntime,
  migrate,
  type ProfileSql,
  profileMigrations,
  type SqlDb,
  type SqlFiles,
  settleProfileDb,
} from "@sprachanker/server/portable";
import { decompress } from "fzstd";
import type { Database } from "sql.js";
import { sqlJsNow } from "./db.ts";

const rows = (db: Database, sql: string, params: unknown[]) => {
  const statement = db.prepare(sql);
  try {
    statement.bind(params as never);
    const out: Array<Record<string, unknown>> = [];
    while (statement.step()) out.push(statement.getAsObject());
    return out;
  } finally {
    statement.free();
  }
};

/** A database as the profile files' code asks: read from `file` whole, written back when let go
 *  (unless read only). */
function sqlDb(fs: DataFs, file: string | undefined, db: Database, readonly: boolean): SqlDb {
  return {
    exec: (sql) => void db.exec(sql),
    all: (sql, ...params) => rows(db, sql, params),
    run: (sql, ...params) => void db.run(sql, params as never),
    close() {
      if (file && !readonly) fs.writeFile(file, db.export());
      db.close();
    },
  };
}

/** The phone's SqlFiles: a file read whole (`:memory:` a new database), migrated by the server's own
 *  migrations (the usual copy beside it first). */
export function phoneSqlFiles(fs: DataFs): SqlFiles {
  const opened = (file: string) => {
    const SQL = sqlJsNow();
    if (file === ":memory:") return new SQL.Database();
    const bytes = fs.readBytes(file);
    if (!bytes) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
    return new SQL.Database(bytes);
  };
  return {
    open: (file, options = {}) => sqlDb(fs, file, opened(file), !!options.readonly),
    migrated(file, upTo = profileMigrations.length) {
      const db = opened(file);
      db.exec("PRAGMA foreign_keys = ON");
      const one = (sql: string) => db.exec(sql)[0]?.values ?? [];
      const dir = dirName(file);
      const name = file.slice(dir.length + 1);
      migrate(
        {
          exec: (sql) => db.exec(sql),
          tags: () => one("SELECT tag FROM _migrations").map((r) => String(r[0])),
          backup: (target) => fs.writeFile(target, db.export()),
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
          foreignKeyViolations: () => one("PRAGMA foreign_key_check").length,
        },
        profileMigrations.slice(0, upTo),
        {
          file,
          now: Date.now(),
          listBackups: () =>
            file === ":memory:"
              ? []
              : fs
                  .list(dir)
                  .filter((f) => f.startsWith(`${name}.bak-`))
                  .map((f) => `${dir}/${f}`),
          remove: (f) => fs.remove(f),
        },
      );
      return sqlDb(fs, file === ":memory:" ? undefined : file, db, false);
    },
  };
}

/** A profile file's SQLite on the phone: the live database as it is in memory (`live`: its bytes),
 *  a copy opened, a received one made ready in the page. */
export function phoneProfileSql(
  fs: DataFs,
  live: (profileId: string) => Uint8Array | undefined,
): ProfileSql {
  const files = phoneSqlFiles(fs);
  return {
    migrations: profileMigrations.map((m) => m.tag),
    copy(profileId, file) {
      const bytes = live(profileId);
      if (!bytes) throw new Error(`no profile ${profileId}`);
      fs.writeFile(file, bytes);
    },
    open: (file) => files.open(file),
    // In the page: a large database holds it up for as long (the phone has no Worker with SQLite).
    settle: async (file, endpoints) => settleProfileDb(files, file, endpoints),
  };
}

/** The bytes of a zstd frame's content, when its header says. */
function declaredSize(b: Uint8Array): number | undefined {
  if (b.length < 6 || b[0] !== 0x28 || b[1] !== 0xb5 || b[2] !== 0x2f || b[3] !== 0xfd) return;
  const fhd = b[4] as number;
  const fcs = fhd >> 6;
  const single = (fhd >> 5) & 1;
  const dict = [0, 1, 2, 4][fhd & 3] as number;
  const at = 5 + (single ? 0 : 1) + dict;
  const size = fcs === 0 ? (single ? 1 : 0) : 1 << fcs;
  if (!size || at + size > b.length) return;
  let n = 0;
  for (let i = size - 1; i >= 0; i--) n = n * 256 + (b[at + i] as number);
  return size === 2 ? n + 256 : n;
}

/** What reading an .apkg needs of the phone: sql.js from bytes, fzstd. */
export const phoneApkg: ApkgRuntime = {
  openSqlite(bytes) {
    const db = new (sqlJsNow().Database)(bytes);
    return { all: (sql) => rows(db, sql, []), close: () => db.close() };
  },
  zstd(bytes, max) {
    const size = declaredSize(bytes);
    if (size !== undefined && size > max) return undefined;
    const out = decompress(bytes);
    return out.length > max ? undefined : out;
  },
};
