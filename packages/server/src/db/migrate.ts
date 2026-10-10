// Forward-only migrations with a copy before migrating and downgrade protection (05, "Migrations").

export interface Migration {
  tag: string;
  sql: string;
}

/** The few SQL operations the migrator needs; implemented per runtime. */
interface SqlDatabase {
  exec(sql: string): void;
  tags(): string[];
  /** Consistent copy of the database file. */
  backup(file: string): void;
  transaction(fn: () => void): void;
  /** Rows `PRAGMA foreign_key_check` reports (0 when every reference resolves). */
  foreignKeyViolations(): number;
}

export class MigrationError extends Error {}

const BACKUPS_KEPT = 5;

export function migrate(
  db: SqlDatabase,
  migrations: Migration[],
  options: { file: string; now: number; listBackups(): string[]; remove(file: string): void },
): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const known = new Set(migrations.map((m) => m.tag));
  const applied = db.tags();
  const unknown = applied.filter((t) => !known.has(t));
  if (unknown.length) {
    throw new MigrationError(
      `${options.file} was written by a newer SprachAnker (migrations ${unknown.join(", ")}); update the app.`,
    );
  }
  const pending = migrations.filter((m) => !applied.includes(m.tag));
  if (!pending.length) return [];
  if (applied.length) {
    db.backup(`${options.file}.bak-${options.now}`);
    const old = options.listBackups().sort().slice(0, -BACKUPS_KEPT);
    for (const file of old) options.remove(file);
  }
  // A migration may rebuild a table others refer to (drizzle-kit: create, copy, drop, rename). SQLite
  // ignores this pragma inside a transaction, so it is switched here, around them; each migration
  // checks the references before it commits. Profile databases always run with foreign keys on.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const m of pending) apply(m);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  return pending.map((m) => m.tag);

  function apply(m: Migration) {
    try {
      db.transaction(() => {
        for (const statement of m.sql.split("--> statement-breakpoint")) {
          if (statement.trim()) db.exec(statement);
        }
        if (db.foreignKeyViolations()) throw new Error("a foreign key no longer resolves");
        db.exec(
          `INSERT INTO _migrations (tag, applied_at) VALUES ('${m.tag.replace(/'/g, "''")}', ${options.now})`,
        );
      });
    } catch (error) {
      throw new MigrationError(
        `migration ${m.tag} failed on ${options.file}: ${(error as Error).message}`,
      );
    }
  }
}
