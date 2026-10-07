// Profile settings: small JSON values by key (05), each key with its schema (schema `settings.ts`).
// Values are checked when written and parsed when read: one that no longer fits reads as unset.
import {
  learnerSettingSchema,
  type SettingKey,
  type SettingValue,
  settingSchema,
} from "@sprachanker/schema";
import { eq } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { settings } from "../db/profile/schema.ts";
import { ServiceError } from "../errors.ts";

export function createSettings(db: ProfileDb) {
  const parsed = (key: string, valueJson: string) => {
    const result = settingSchema(key)?.safeParse(JSON.parse(valueJson));
    return result?.success ? result.data : undefined;
  };
  const write = (key: string, value: unknown) => {
    const valueJson = JSON.stringify(value);
    db.insert(settings)
      .values({ key, valueJson })
      .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
      .run();
  };

  return {
    /** The learner's preferences (what the settings route reads and writes). */
    all(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      for (const row of db.select().from(settings).all()) {
        if (!learnerSettingSchema(row.key)) continue;
        const value = parsed(row.key, row.valueJson);
        if (value !== undefined) out[row.key] = value;
      }
      return out;
    },
    get<K extends SettingKey>(key: K): SettingValue<K> | undefined {
      const row = db.select().from(settings).where(eq(settings.key, key)).get();
      return row ? (parsed(key, row.valueJson) as SettingValue<K> | undefined) : undefined;
    },
    /** A service's own setting (or a preference set on the learner's behalf). */
    set<K extends SettingKey>(key: K, value: SettingValue<K>) {
      write(key, settingSchema(key)?.parse(value));
    },
    /** A preference from the settings route: only the learner's keys, only values that fit. */
    setByLearner(key: string, value: unknown) {
      const schema = learnerSettingSchema(key);
      if (!schema) throw new ServiceError("unknown_setting", 400);
      const result = schema.safeParse(value);
      if (!result.success) throw new ServiceError("invalid_setting", 400);
      write(key, result.data);
    },
  };
}
export type Settings = ReturnType<typeof createSettings>;
