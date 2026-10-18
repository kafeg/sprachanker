// Deck files on disk: each export or import in a transfer folder of its own, `decks/.transfers/<id>/`
// (transfers.ts) — on the decks' disk, so files link and move into place. An export's files linked
// there (a job writing the deck meanwhile leaves the file whole), each summed, streamed as a zip
// (course-kit); a received file read by its zip directory, unpacked streaming and hashed, then placed
// into its deck's folder: a new folder beside it, swapped in whole (decks.ts's replaceFolder).
// An .apkg's media: files of the decks and the library linked as the zip's numbered entries.
import {
  aliased,
  bytesEntry,
  chunksOf,
  dirName,
  entryStream,
  entryText,
  fileEntry,
  fileSums,
  joinPath,
  linkOrCopy,
  writeChunks,
  zipEntries,
  zipLength,
  zipLimits,
} from "@sprachanker/course-kit";
import { DECK_BUNDLE_MAX_FILES, DeckBundlePath, DeckFolder } from "@sprachanker/schema";
import type { BundleFileEntry } from "../services/course-transfer.ts";
import type { DeckTransferFiles, ZipHead } from "../services/deck-transfer.ts";
import { replaceFolder } from "./decks.ts";
import { type DataRoot, under } from "./root.ts";
import { type TransferOptions, transferFolders } from "./transfers.ts";

const MANIFEST = "manifest.json";
/** A manifest is a line per file: a deck's is under a few MB. */
const MANIFEST_MAX = 32 * 1024 * 1024;
/** deck.json and extras.json are read whole: a deck of tens of thousands of words is far less. */
const JSON_MAX = 64 * 1024 * 1024;
/** A deck file's zip: its files and manifest, names short (`media/<name>`, at most 255 bytes). */
const ZIP_LIMITS = zipLimits(DECK_BUNDLE_MAX_FILES + 1, 512, 128);

export function deckTransferFiles(
  data: DataRoot,
  options: TransferOptions = {},
): DeckTransferFiles {
  const { fs } = data;
  const isFile = (path: string) => {
    const info = fs.stat(path);
    return !!info && !info.dir;
  };
  const decksRoot = under(data, "decks");
  const root = joinPath(decksRoot, ".transfers");
  const t = transferFolders(fs, root, options);
  const filesOf = (id: string) => joinPath(t.folder(id), "files");
  const received = (id: string) => joinPath(t.folder(id), "received");
  const deckFolder = (folder: string) => {
    if (!DeckFolder.safeParse(folder).success) throw new Error(`bad deck folder ${folder}`);
    return joinPath(decksRoot, folder);
  };
  /** Each staged export's files with their size and CRC-32 (the zip's), until it is streamed. */
  const sums = new Map<string, Map<string, { size: number; crc32: number }>>();
  const discard = (id: string) => {
    sums.delete(id);
    t.discard(id);
  };
  /** The entries of a received file, its manifest apart; each name a path a deck file may hold,
   *  and once — also to a disk that does not tell case or Unicode forms apart. */
  const entriesOf = (id: string) =>
    t.once(id, received(id), () => {
      const entries = zipEntries(fs, received(id), ZIP_LIMITS);
      if (!entries) return undefined;
      const manifest = entries.find((e) => e.name === MANIFEST);
      const others = entries.filter((e) => e !== manifest);
      if (
        aliased(entries.map((e) => e.name)) ||
        !manifest ||
        manifest.size > MANIFEST_MAX ||
        others.some((e) => !DeckBundlePath.safeParse(e.name).success)
      )
        return undefined;
      return { manifest, others };
    });
  /** The zip's entries: those in memory first (a deck file's manifest), then the staged files in the
   *  order given. */
  const zipOf = (id: string, head: ZipHead[], paths: string[]) => {
    const of = sums.get(id);
    return [
      ...head.map((e) => bytesEntry(e.name, e.bytes)),
      ...paths.map((path) => {
        const sum = of?.get(path);
        if (!sum) throw new Error(`${path} is not in transfer ${id}`);
        return fileEntry(fs, path, joinPath(filesOf(id), path), sum);
      }),
    ];
  };

  return {
    sweep: t.sweep,
    async stage(folder, paths) {
      const from = deckFolder(folder);
      const id = t.begin();
      try {
        const files: BundleFileEntry[] = [];
        const summed = new Map<string, { size: number; crc32: number }>();
        for (const path of new Set(paths)) {
          const file = joinPath(from, path);
          // One gone meanwhile (made audio removed), or one no deck file may hold, is not in it.
          if (!DeckBundlePath.safeParse(path).success || !isFile(file)) continue;
          const to = joinPath(filesOf(id), path);
          fs.mkdir(dirName(to));
          linkOrCopy(fs, file, to, () => t.room(root, fs.stat(file)?.size ?? 0));
          const { sha256, size, crc32 } = await fileSums(fs, to);
          files.push({ path, size, sha256 });
          summed.set(path, { size, crc32 });
        }
        sums.set(id, summed);
        return { id, files };
      } catch (error) {
        discard(id);
        throw error;
      }
    },
    async stageNumbered(sources) {
      const id = t.begin();
      try {
        const staged: number[] = [];
        const summed = new Map<string, { size: number; crc32: number }>();
        for (const [i, source] of sources.entries()) {
          const parts = source.path.split("/");
          // Only a file under the decks or the library, by a path of plain names.
          if (parts.some((p) => !p || p === "." || p === ".." || p.includes("\\"))) continue;
          const file = under(data, source.root, ...parts);
          if (!isFile(file)) continue;
          const name = String(staged.length);
          const to = joinPath(filesOf(id), name);
          fs.mkdir(dirName(to));
          linkOrCopy(fs, file, to, () => t.room(root, fs.stat(file)?.size ?? 0));
          const { size, crc32 } = await fileSums(fs, to);
          summed.set(name, { size, crc32 });
          staged.push(i);
        }
        sums.set(id, summed);
        return { id, staged };
      } catch (error) {
        discard(id);
        throw error;
      }
    },
    bytes: (id, head, paths) => zipLength(zipOf(id, head, paths)),
    stream(id, head, paths) {
      const entries = zipOf(id, head, paths);
      sums.delete(id);
      return t.zip(id, entries);
    },
    begin: t.begin,
    // The file, and as much again unpacked.
    receive: (id, body, length) => t.receive(id, "received", body, length, 2 * length),
    read(id) {
      const entries = entriesOf(id);
      if (!entries) return undefined;
      return {
        manifest: entryText(fs, received(id), entries.manifest),
        entries: entries.others.map((e) => ({ path: e.name, size: e.size })),
      };
    },
    async unpack(id, manifest) {
      const entries = entriesOf(id);
      if (!entries) return "damaged";
      const listed = new Map(manifest.files.map((f) => [f.path, f]));
      if (manifest.files.some((f) => f.path.endsWith(".json") && f.size > JSON_MAX))
        return "damaged";
      for (const e of entries.others) {
        const written = await writeChunks(
          fs,
          joinPath(filesOf(id), e.name),
          t.touching(id, entryStream(fs, received(id), e)),
          e.size,
        );
        // The first file not as listed ends it.
        const want = listed.get(e.name);
        if (!written || written.size !== want?.size || written.sha256 !== want.sha256)
          return "damaged";
      }
      // What it held is unpacked: the file itself is no longer needed while it waits.
      fs.remove(received(id));
      return "ok";
    },
    text: (id, path) => fs.readText(joinPath(filesOf(id), path)),
    async place(id, folder, written, media) {
      const target = deckFolder(folder);
      await replaceFolder(fs, decksRoot, target, async (fresh) => {
        for (const path of new Set(media)) {
          if (!DeckBundlePath.safeParse(path).success || !path.startsWith("media/")) continue;
          const from = joinPath(filesOf(id), path);
          // A file the folder has under the name stays; one the deck file does not hold is none.
          if (fs.stat(joinPath(target, path)) || !isFile(from)) continue;
          linkOrCopy(fs, from, joinPath(fresh, path), () => t.room(root, fs.stat(from)?.size ?? 0));
        }
        if (written.extras !== undefined)
          await fs.write(joinPath(fresh, "extras.json"), chunksOf(written.extras));
        if (written.deck !== undefined)
          await fs.write(joinPath(fresh, "deck.json"), chunksOf(written.deck));
      });
    },
    discard,
  };
}
