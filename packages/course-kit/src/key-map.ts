// Keys that stay when a source reorders (02, "Keys"): a lesson or exercise numbered by its place gets
// that number the first time it is seen, and keeps it by its source id. One inserted, moved or dropped
// at the source shifts no other key, so answers, mistakes and cards stay on what they were about. A
// new one takes the number of its place when that is free in its scope, else the next free number.
// Kept per series in `keys.json` (the normaliser's own state, beside media.json).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./files.ts";

/** By scope (a course's unit, a lesson), each source id's number. */
const Stored = z.record(z.string(), z.record(z.string(), z.number().int().positive()));
type Stored = z.infer<typeof Stored>;

export interface KeyMap {
  /** The number of `sourceId` in `scope`: its own, else `position` when free, else the next free. */
  number(scope: string, sourceId: string, position: number): number;
  /** Writes the map back when it gained numbers. */
  save(): Promise<void>;
}

export async function openKeyMap(seriesDir: string): Promise<KeyMap> {
  const file = join(seriesDir, "keys.json");
  // None yet: a series normalised the first time. One that does not read stops the normaliser: numbering
  // afresh would give kept keys to other lessons and exercises.
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const stored: Stored = text === undefined ? {} : Stored.parse(JSON.parse(text));
  let changed = false;
  return {
    number(scope, sourceId, position) {
      const numbers = stored[scope] ?? {};
      stored[scope] = numbers;
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

/** Source ids of one scope as the key map takes them: an id met again is numbered per occurrence
 *  (`id`, `id.2`, …), so a part the source lists twice keeps a key for each. */
export function occurrences(): (id: string) => string {
  const seen = new Map<string, number>();
  return (id) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}.${n}`;
  };
}
