// Imported decks on disk (05, "Locations"): `<data-root>/decks/<id>/` with deck.json and media/; a
// folder replaced whole (written beside, then renamed into place); and what reading an .apkg needs of
// the runtime: SQLite from bytes, zstd.
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApkgRuntime } from "@sprachanker/anki-export";
import type { DeckFiles } from "../services/decks.ts";

/** A deck folder's name: an id, never a temporary folder (they start with a dot). */
const ID = /^[a-z0-9][a-z0-9~._-]*$/;
const MEDIA = /^media\/(?!\.\.?$)[^/\\]+$/;

export function deckFiles(dataRoot: string): DeckFiles {
  const root = join(dataRoot, "decks");
  const folder = (id: string) => {
    if (!ID.test(id)) throw new Error(`bad deck id ${id}`);
    return join(root, id);
  };
  const isFile = (path: string) => !!statSync(path, { throwIfNoEntry: false })?.isFile();
  return {
    ids: () =>
      statSync(root, { throwIfNoEntry: false })?.isDirectory()
        ? readdirSync(root).filter((name) => ID.test(name) && isFile(join(root, name, "deck.json")))
        : [],
    read(id) {
      const file = join(folder(id), "deck.json");
      return isFile(file) ? readFileSync(file, "utf8") : undefined;
    },
    async write(id, deck, media) {
      const target = folder(id);
      const fresh = join(root, `.${id}.tmp-${randomUUID().slice(0, 8)}`);
      try {
        await mkdir(join(fresh, "media"), { recursive: true });
        for (const [path, bytes] of media) {
          if (!MEDIA.test(path)) throw new Error(`bad deck media path ${path}`);
          await writeFile(join(fresh, path), bytes);
        }
        await writeFile(join(fresh, "deck.json"), deck);
        const old = `${fresh}.old`;
        const had = !!statSync(target, { throwIfNoEntry: false });
        if (had) renameSync(target, old);
        try {
          renameSync(fresh, target);
        } catch (error) {
          // The deck as it was stays.
          if (had) renameSync(old, target);
          throw error;
        }
        rmSync(old, { recursive: true, force: true });
      } finally {
        rmSync(fresh, { recursive: true, force: true });
      }
    },
    remove: (id) => rmSync(folder(id), { recursive: true, force: true }),
    media(id, path) {
      if (!MEDIA.test(path)) return undefined;
      const file = join(folder(id), path);
      return isFile(file) ? Bun.file(file) : undefined;
    },
  };
}

export const apkgRuntime: ApkgRuntime = {
  openSqlite(bytes) {
    const db = Database.deserialize(bytes, { readonly: true });
    return {
      all: (sql) => db.query(sql).all() as Array<Record<string, unknown>>,
      close: () => db.close(),
    };
  },
  zstd: (bytes) => new Uint8Array(Bun.zstdDecompressSync(bytes)),
};
