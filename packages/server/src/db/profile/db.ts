// Type of the profile database as services see it (runtime-agnostic; opened in src/runtime/).
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema.ts";

export type ProfileDb = BaseSQLiteDatabase<"sync", unknown, typeof schema>;
