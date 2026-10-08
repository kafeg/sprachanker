// Keys that stay when a source reorders (02, "Keys"): a lesson or exercise numbered by its place gets
// that number the first time it is seen, and keeps it by its source id. One inserted, moved or dropped
// at the source shifts no other key, so answers, mistakes and cards stay on what they were about. A
// new one takes the number of its place when that is free in its scope, else the next free number.
// Kept per series in `keys.json` (the normaliser's own state, beside media.json).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./files.ts";

/** By scope (a course's unit, a lesson), each source id's number. */
type Stored = Record<string, Record<string, number>>;

export interface KeyMap {
  /** The number of `sourceId` in `scope`: its own, else `position` when free, else the next free. */
  number(scope: string, sourceId: string, position: number): number;
  /** Writes the map back when it gained numbers. */
  save(): Promise<void>;
}

export async function openKeyMap(seriesDir: string): Promise<KeyMap> {
  const file = join(seriesDir, "keys.json");
  const stored: Stored = await readFile(file, "utf8")
    .then((text) => JSON.parse(text) as Stored)
    .catch(() => ({}));
  let changed = false;
  return {
    number(scope, sourceId, position) {
      const numbers = (stored[scope] ??= {});
      const own = numbers[sourceId];
      if (own !== undefined) return own;
      const taken = new Set(Object.values(numbers));
      const n = taken.has(position) ? Math.max(...taken) + 1 : position;
      numbers[sourceId] = n;
      changed = true;
      return n;
    },
    async save() {
      if (!changed) return;
      await writeFileAtomic(file, `${JSON.stringify(stored, null, 1)}\n`);
      changed = false;
    },
  };
}
