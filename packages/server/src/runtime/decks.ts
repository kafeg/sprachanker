// Imported decks on disk: `<data-root>/decks/<id>/` with deck.json and media/; a
// folder replaced whole (written beside, then renamed into place); a deck folder's extras.json and the
// audio read aloud for its words (an imported deck's, a course's `course~…`); packages uploaded to be imported,
// streamed to `decks/.uploads/`; and what reading an .apkg needs of the runtime: SQLite from bytes, zstd.
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { ApkgRuntime } from "@sprachanker/anki-export";
import type { DeckFiles } from "../services/decks.ts";

/** A deck folder's name: an id, never a temporary folder (they start with a dot). */
const ID = /^[a-z0-9][a-z0-9~._-]*$/;
const MEDIA = /^media\/(?!\.\.?$)[^/\\]+$/;
const UPLOAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An upload not imported within a day goes. */
const UPLOAD_KEPT_MS = 24 * 60 * 60_000;
/** A deck folder being written (`.<id>.tmp-<x>`), and the one it replaces (`… .old`). */
const WRITING = /^\.(.+)\.tmp-[0-9a-f]{8}(\.old)?$/;
/** What the server made for a deck's words (audio read aloud), beside deck.json. */
const EXTRAS = "extras.json";

/** A file written whole: beside it, then renamed into place (its folder made). */
function writeWhole(file: string, data: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  const part = `${file}.part`;
  writeFileSync(part, data);
  renameSync(part, file);
}

/** A file linked to another name, else copied (a disk without hard links: exFAT, a network share). */
function linked(from: string, to: string) {
  try {
    linkSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
}

export function deckFiles(dataRoot: string): DeckFiles {
  const root = join(dataRoot, "decks");
  const uploads = join(root, ".uploads");
  const folder = (id: string) => {
    if (!ID.test(id)) throw new Error(`bad deck id ${id}`);
    return join(root, id);
  };
  const uploaded = (upload: string, ext = "apkg") =>
    UPLOAD.test(upload) ? join(uploads, `${upload}.${ext}`) : "";
  const isFile = (path: string) => !!path && !!statSync(path, { throwIfNoEntry: false })?.isFile();
  /** Uploads a day old go (one gone meanwhile is no matter). */
  const sweepUploads = () => {
    for (const name of statSync(uploads, { throwIfNoEntry: false }) ? readdirSync(uploads) : []) {
      const path = join(uploads, name);
      const at = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
      if (at !== undefined && Date.now() - at > UPLOAD_KEPT_MS) rmSync(path, { force: true });
    }
  };
  return {
    ids: () =>
      statSync(root, { throwIfNoEntry: false })?.isDirectory()
        ? readdirSync(root).filter((name) => ID.test(name) && isFile(join(root, name, "deck.json")))
        : [],
    read(id) {
      const file = join(folder(id), "deck.json");
      return isFile(file) ? readFileSync(file, "utf8") : undefined;
    },
    writeDeck: (id, text) => writeWhole(join(folder(id), "deck.json"), text),
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
        // The deck's earlier media and extras stay, linked: the deck as it was is untouched until
        // swapped.
        const earlier = join(target, "media");
        if (had && statSync(earlier, { throwIfNoEntry: false })?.isDirectory())
          for (const name of readdirSync(earlier))
            if (!statSync(join(fresh, "media", name), { throwIfNoEntry: false }))
              linked(join(earlier, name), join(fresh, "media", name));
        if (isFile(join(target, EXTRAS))) linked(join(target, EXTRAS), join(fresh, EXTRAS));
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
    extras(id) {
      const file = join(folder(id), EXTRAS);
      return isFile(file) ? readFileSync(file, "utf8") : undefined;
    },
    writeExtras: (id, text) => writeWhole(join(folder(id), EXTRAS), text),
    writeMedia(id, path, bytes) {
      if (!MEDIA.test(path)) throw new Error(`bad deck media path ${path}`);
      writeWhole(join(folder(id), path), bytes);
    },
    removeMedia(id, path) {
      if (MEDIA.test(path)) rmSync(join(folder(id), path), { force: true });
    },
    folders: () =>
      statSync(root, { throwIfNoEntry: false })?.isDirectory()
        ? readdirSync(root).filter(
            (name) => ID.test(name) && statSync(join(root, name)).isDirectory(),
          )
        : [],
    async stage(body, max) {
      mkdirSync(uploads, { recursive: true });
      sweepUploads();
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
    unstage(upload, deck) {
      if (!uploaded(upload)) return;
      if (deck) writeFileSync(uploaded(upload, "deck"), deck);
      rmSync(uploaded(upload), { force: true });
    },
    sweep() {
      sweepUploads();
      for (const name of statSync(root, { throwIfNoEntry: false }) ? readdirSync(root) : []) {
        const [, id, old] = WRITING.exec(name) ?? [];
        if (!id) continue;
        // A deck left only as the folder it was replaced by (stopped between the renames) is back.
        if (old && ID.test(id) && !statSync(join(root, id), { throwIfNoEntry: false }))
          renameSync(join(root, name), join(root, id));
        else rmSync(join(root, name), { recursive: true, force: true });
      }
    },
    made(upload) {
      const note = uploaded(upload, "deck");
      return isFile(note) ? readFileSync(note, "utf8") : undefined;
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
  zstd(bytes, max) {
    try {
      return new Uint8Array(zstdDecompressSync(bytes, { maxOutputLength: max }));
    } catch (error) {
      // Stopped once past `max` bytes, not after.
      if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return undefined;
      throw error;
    }
  },
};
