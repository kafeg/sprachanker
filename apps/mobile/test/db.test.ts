// The phone's databases (src/db.ts) over files kept in memory: a new one written at once, a change
// written a moment later and read back on reopening, a transaction inside another a savepoint
// (rolled back alone when it fails).
import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { profileMigrations, profileSchema } from "@sprachanker/server/portable";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sql-js";
import { openDb, sqlJsWasmAt } from "../src/db.ts";
import type { Files } from "../src/files.ts";

sqlJsWasmAt(
  join(
    dirname(createRequire(import.meta.url).resolve("sql.js/package.json")),
    "dist",
    "sql-wasm.wasm",
  ),
);

/** The app's files in memory: what db.ts uses of them. */
function memoryFiles() {
  const kept = new Map<string, Uint8Array>();
  const files = {
    has: (p: string) => kept.has(p),
    read: async (p: string) => kept.get(p),
    write: async (p: string, b: Uint8Array) => void kept.set(p, b.slice()),
    remove: async (p: string) => void kept.delete(p),
    abs: (p: string) => `/root/${p}`,
    fs: { files: () => [] as string[] },
  };
  return { kept, files: files as unknown as Files };
}
const settled = () => new Promise((r) => setTimeout(r, 1200));

test("a new database is written at once; a change a moment later, read back on reopening", async () => {
  const { kept, files } = memoryFiles();
  const opened = await openDb(files, "profiles/a/profile.sqlite", profileMigrations);
  await new Promise((r) => setTimeout(r, 50));
  expect(kept.has("profiles/a/profile.sqlite")).toBe(true);
  const db = drizzle(opened.db, { schema: profileSchema });
  db.insert(profileSchema.settings).values({ key: "k", valueJson: '"v"' }).run();
  await settled();
  await opened.close();
  const again = await openDb(files, "profiles/a/profile.sqlite", profileMigrations);
  const read = drizzle(again.db, { schema: profileSchema });
  expect(
    read.select().from(profileSchema.settings).where(eq(profileSchema.settings.key, "k")).all(),
  ).toEqual([{ key: "k", valueJson: '"v"' }]);
  await again.close();
});

test("a transaction inside another is a savepoint: the inner one failing leaves the outer's work", async () => {
  const { files } = memoryFiles();
  const opened = await openDb(files, "p.sqlite", profileMigrations);
  const db = drizzle(opened.db, { schema: profileSchema });
  const { settings } = profileSchema;
  db.transaction(() => {
    db.insert(settings).values({ key: "outer", valueJson: "1" }).run();
    expect(() =>
      db.transaction(() => {
        db.insert(settings).values({ key: "inner", valueJson: "2" }).run();
        throw new Error("inner fails");
      }),
    ).toThrow("inner fails");
    db.transaction(() => {
      db.insert(settings).values({ key: "second", valueJson: "3" }).run();
    });
  });
  const keys = db
    .select()
    .from(settings)
    .all()
    .map((r) => r.key)
    .sort();
  expect(keys).toEqual(["outer", "second"]);
  // The outer one failing undoes everything.
  expect(() =>
    db.transaction(() => {
      db.insert(settings).values({ key: "gone", valueJson: "4" }).run();
      throw new Error("outer fails");
    }),
  ).toThrow("outer fails");
  expect(
    db
      .select()
      .from(settings)
      .all()
      .map((r) => r.key)
      .sort(),
  ).toEqual(["outer", "second"]);
  await opened.close();
});
