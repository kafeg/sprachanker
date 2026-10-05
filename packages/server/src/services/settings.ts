// Profile settings: small JSON values by key (05).
import { eq } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { settings } from "../db/profile/schema.ts";

export function createSettings(db: ProfileDb) {
  return {
    all(): Record<string, unknown> {
      return Object.fromEntries(
        db
          .select()
          .from(settings)
          .all()
          .map((s) => [s.key, JSON.parse(s.valueJson)]),
      );
    },
    set(key: string, value: unknown) {
      const valueJson = JSON.stringify(value);
      db.insert(settings)
        .values({ key, valueJson })
        .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
        .run();
    },
    get<T>(key: string): T | undefined {
      const row = db.select().from(settings).where(eq(settings.key, key)).get();
      return row ? (JSON.parse(row.valueJson) as T) : undefined;
    },
  };
}
export type Settings = ReturnType<typeof createSettings>;
