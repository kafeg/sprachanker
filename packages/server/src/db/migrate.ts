// Forward-only migrations with a copy before migrating and downgrade protection (05, "Migrations").

export interface Migration {
  tag: string;
  sql: string;
}

/** The few SQL operations the migrator needs; implemented per runtime. */
export interface SqlDatabase {
  exec(sql: string): void;
  tags(): string[];
  /** Consistent copy of the database file. */
  backup(file: string): void;
  transaction(fn: () => void): void;
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
  for (const m of pending) {
    try {
      db.transaction(() => {
        for (const statement of m.sql.split("--> statement-breakpoint")) {
          if (statement.trim()) db.exec(statement);
        }
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
  return pending.map((m) => m.tag);
}
