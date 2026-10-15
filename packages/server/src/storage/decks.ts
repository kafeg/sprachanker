// Imported decks on disk: `<data-root>/decks/<id>/` with deck.json and media/; a
// folder replaced whole (written beside, then renamed into place); a deck folder's extras.json and the
// audio read aloud for its words (an imported deck's, a course's `course~…`); and packages uploaded to
// be imported, streamed to `decks/.uploads/`. What reading an .apkg needs of the runtime (SQLite from
// bytes, zstd) is the runtime's (runtime/apkg.ts, the phone's own).
import { chunksOf, type DataFs, joinPath, linkOrCopy, readAll } from "@sprachanker/course-kit";
import type { MediaBlob } from "../media.ts";
import type { DeckFiles } from "../services/decks.ts";
import { type DataRoot, under } from "./root.ts";

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
const DECK = "deck.json";

const isFile = (fs: DataFs, path: string) => {
  const info = !!path && fs.stat(path);
  return !!info && !info.dir;
};

/**
 * A deck folder (`target`, in `root`) written anew whole, or not at all: `fill` writes a fresh folder
 * beside it; what of the folder as it was `fill` did not write stays, linked in — its media (a card
 * of a word an update drops keeps its audio), extras.json, deck.json —; then the fresh folder is
 * swapped into place, the folder as it was untouched until then.
 */
export async function replaceFolder(
  fs: DataFs,
  root: string,
  target: string,
  fill: (fresh: string) => Promise<void>,
) {
  const id = target.slice(target.lastIndexOf("/") + 1);
  const fresh = joinPath(root, `.${id}.tmp-${crypto.randomUUID().slice(0, 8)}`);
  try {
    fs.mkdir(joinPath(fresh, "media"));
    await fill(fresh);
    const old = `${fresh}.old`;
    const had = !!fs.stat(target);
    const earlier = joinPath(target, "media");
    if (had && fs.stat(earlier)?.dir)
      for (const name of fs.list(earlier))
        if (!fs.stat(joinPath(fresh, "media", name)))
          linkOrCopy(fs, joinPath(earlier, name), joinPath(fresh, "media", name));
    for (const name of [EXTRAS, DECK])
      if (isFile(fs, joinPath(target, name)) && !fs.stat(joinPath(fresh, name)))
        linkOrCopy(fs, joinPath(target, name), joinPath(fresh, name));
    if (had) fs.rename(target, old);
    try {
      fs.rename(fresh, target);
    } catch (error) {
      // The folder as it was stays.
      if (had) fs.rename(old, target);
      throw error;
    }
    fs.remove(old);
  } finally {
    fs.remove(fresh);
  }
}

/** The deck folders of the data root; `blob`: a file served as the runtime serves one. */
export function deckFiles(data: DataRoot, blob: (file: string) => MediaBlob): DeckFiles {
  const { fs } = data;
  const root = under(data, "decks");
  const uploads = joinPath(root, ".uploads");
  const folder = (id: string) => {
    if (!ID.test(id)) throw new Error(`bad deck id ${id}`);
    return joinPath(root, id);
  };
  const uploaded = (upload: string, ext = "apkg") =>
    UPLOAD.test(upload) ? joinPath(uploads, `${upload}.${ext}`) : "";
  /** Uploads a day old go (one gone meanwhile is no matter). */
  const sweepUploads = () => {
    for (const name of fs.list(uploads)) {
      const path = joinPath(uploads, name);
      const at = fs.stat(path)?.mtimeMs;
      if (at !== undefined && Date.now() - at > UPLOAD_KEPT_MS) fs.remove(path);
    }
  };
  return {
    ids: () =>
      fs.list(root).filter((name) => ID.test(name) && isFile(fs, joinPath(root, name, DECK))),
    read: (id) => fs.readText(joinPath(folder(id), DECK)),
    writeDeck: (id, text) => fs.writeFile(joinPath(folder(id), DECK), text),
    async write(id, media, deck) {
      await replaceFolder(fs, root, folder(id), async (fresh) => {
        for (const batch of media)
          for (const [path, bytes] of batch) {
            if (!MEDIA.test(path)) throw new Error(`bad deck media path ${path}`);
            await fs.write(joinPath(fresh, path), chunksOf(bytes));
          }
        await fs.write(joinPath(fresh, DECK), chunksOf(deck()));
      });
    },
    remove: (id) => fs.remove(folder(id)),
    media(id, path) {
      if (!MEDIA.test(path)) return undefined;
      const file = joinPath(folder(id), path);
      return isFile(fs, file) ? blob(file) : undefined;
    },
    extras: (id) => fs.readText(joinPath(folder(id), EXTRAS)),
    writeExtras: (id, text) => fs.writeFile(joinPath(folder(id), EXTRAS), text),
    writeMedia(id, path, bytes) {
      if (!MEDIA.test(path)) throw new Error(`bad deck media path ${path}`);
      fs.writeFile(joinPath(folder(id), path), bytes);
    },
    removeMedia(id, path) {
      if (MEDIA.test(path)) fs.remove(joinPath(folder(id), path));
    },
    async stage(body, max) {
      fs.mkdir(uploads);
      sweepUploads();
      const upload = crypto.randomUUID();
      const file = uploaded(upload);
      try {
        const written = await fs.write(file, body, { max });
        if (written) return upload;
        fs.remove(file);
        return undefined;
      } catch (error) {
        fs.remove(file);
        throw error;
      }
    },
    // Read through its stream: a package can be hundreds of megabytes.
    staged: async (upload) =>
      isFile(fs, uploaded(upload)) ? readAll(fs, uploaded(upload)) : undefined,
    unstage(upload, deck) {
      if (!uploaded(upload)) return;
      if (deck) fs.writeFile(uploaded(upload, "deck"), deck);
      fs.remove(uploaded(upload));
    },
    sweep() {
      sweepUploads();
      for (const name of fs.list(root)) {
        const [, id, old] = WRITING.exec(name) ?? [];
        if (!id) continue;
        // A deck left only as the folder it was replaced by (stopped between the renames) is back.
        if (old && ID.test(id) && !fs.stat(joinPath(root, id)))
          fs.rename(joinPath(root, name), joinPath(root, id));
        else fs.remove(joinPath(root, name));
      }
    },
    made: (upload) => (uploaded(upload) ? fs.readText(uploaded(upload, "deck")) : undefined),
  };
}
