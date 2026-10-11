// Imported decks on disk (05, "Locations"): `<data-root>/decks/<id>/` with deck.json and media/; a
// folder replaced whole (written beside, then renamed into place); packages uploaded to be imported,
// streamed to `decks/.uploads/`; and what reading an .apkg needs of the runtime: SQLite from bytes, zstd.
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApkgRuntime } from "@sprachanker/anki-export";
import type { DeckFiles } from "../services/decks.ts";

/** A deck folder's name: an id, never a temporary folder (they start with a dot). */
const ID = /^[a-z0-9][a-z0-9~._-]*$/;
const MEDIA = /^media\/(?!\.\.?$)[^/\\]+$/;
const UPLOAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An upload not imported within a day goes. */
const UPLOAD_KEPT_MS = 24 * 60 * 60_000;

export function deckFiles(dataRoot: string): DeckFiles {
  const root = join(dataRoot, "decks");
  const uploads = join(root, ".uploads");
  const folder = (id: string) => {
    if (!ID.test(id)) throw new Error(`bad deck id ${id}`);
    return join(root, id);
  };
  const uploaded = (upload: string) => (UPLOAD.test(upload) ? join(uploads, `${upload}.apkg`) : "");
  const isFile = (path: string) => !!path && !!statSync(path, { throwIfNoEntry: false })?.isFile();
  return {
    ids: () =>
      statSync(root, { throwIfNoEntry: false })?.isDirectory()
        ? readdirSync(root).filter((name) => ID.test(name) && isFile(join(root, name, "deck.json")))
        : [],
    read(id) {
      const file = join(folder(id), "deck.json");
      return isFile(file) ? readFileSync(file, "utf8") : undefined;
    },
    async write(id, media, deck) {
      const target = folder(id);
      const fresh = join(root, `.${id}.tmp-${randomUUID().slice(0, 8)}`);
      try {
        await mkdir(join(fresh, "media"), { recursive: true });
        for (const batch of media)
          for (const [path, bytes] of batch) {
            if (!MEDIA.test(path)) throw new Error(`bad deck media path ${path}`);
            await writeFile(join(fresh, path), bytes);
          }
        await writeFile(join(fresh, "deck.json"), deck());
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
    async stage(body, max) {
      mkdirSync(uploads, { recursive: true });
      for (const name of readdirSync(uploads)) {
        const path = join(uploads, name);
        if (Date.now() - statSync(path).mtimeMs > UPLOAD_KEPT_MS) rmSync(path, { force: true });
      }
      const upload = randomUUID();
      const file = uploaded(upload);
      const sink = Bun.file(file).writer();
      let size = 0;
      try {
        for await (const chunk of body) {
          size += chunk.byteLength;
          if (size > max) {
            await sink.end();
            rmSync(file, { force: true });
            return undefined;
          }
          sink.write(chunk);
        }
        await sink.end();
        return upload;
      } catch (error) {
        rmSync(file, { force: true });
        throw error;
      }
    },
    staged(upload) {
      if (!isFile(uploaded(upload))) return undefined;
      // The file's own buffer, not a copy: a package can be hundreds of megabytes.
      const bytes = readFileSync(uploaded(upload));
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
    unstage(upload) {
      if (uploaded(upload)) rmSync(uploaded(upload), { force: true });
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
