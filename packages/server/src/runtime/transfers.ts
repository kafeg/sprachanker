// Transfer folders (05, "Profile file"; 02, "Course bundle"): a file being exported or imported works
// in a folder of its own — `profiles/.transfers/<id>/`, `library/.transfers/<id>/` — removed when it
// ends, an hour old at most. What profile files and course bundles share: the folders and their sweep,
// the room a transfer needs on the disk, a file received or saved, a zip streamed.
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  utimesSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { writeChunks, type ZipSource, zipStream } from "@sprachanker/course-kit";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A transfer left this long (an export never downloaded, an import cut short) goes. */
const KEPT_MS = 60 * 60_000;
/** How often a transfer in use marks its folder's time (another process's sweep goes by it). */
const TOUCH_MS = 60_000;
/** Room a transfer leaves free on the data root's disk beyond what it writes: the larger of 1 GB and
 *  5 % of the disk (the server and the learners' own work go on beside it). */
const dataRootMargin = (diskBytes: number) => Math.max(1024 ** 3, 0.05 * diskBytes);
/** Room left free beyond a file written elsewhere (a file saved where the command was told). */
const FILE_MARGIN = 16 * 1024 * 1024;

export type Disk = { free: number; size: number };

/** The disk of `dir`: the bytes free for this user, and its size; null when the system does not say. */
export function diskOf(dir: string): Disk | null {
  try {
    const disk = statfsSync(dir);
    return { free: disk.bavail * disk.bsize, size: disk.blocks * disk.bsize };
  } catch {
    return null;
  }
}

/** A full disk, found before writing: the same error a write that runs out of room gives. */
const noSpace = () => Object.assign(new Error("not enough free space"), { code: "ENOSPC" });

export interface TransferOptions {
  disk?: (dir: string) => Disk | null;
  /** Whether this process may sweep: not the command line while a server runs on the data root
   *  (its transfers are the server's). */
  sweeps?: () => boolean;
}

/** `beforeRemove`: what a transfer swept leaves to mend first (a course folder an install put aside). */
export function transferFolders(
  root: string,
  options: TransferOptions = {},
  beforeRemove?: (folder: string) => void,
) {
  const diskAt = options.disk ?? diskOf;
  /** This process's transfers in use: never swept. */
  const active = new Set<string>();
  /** A transfer's folder marked as in use for another process's sweep (its time), at most a minute
   *  apart. */
  const touched = new Map<string, number>();
  const folder = (id: string) => {
    if (!ID.test(id)) throw new Error(`bad transfer id ${id}`);
    return join(root, id);
  };
  const touch = (id: string) => {
    if (Date.now() - (touched.get(id) ?? 0) < TOUCH_MS) return;
    touched.set(id, Date.now());
    const now = new Date();
    try {
      utimesSync(folder(id), now, now);
    } catch {}
  };
  const self = {
    root,
    folder,
    sweeps: () => !options.sweeps || options.sweeps(),
    /** Transfers an hour old go (never one this process is using). */
    sweep() {
      if (!self.sweeps()) return;
      for (const name of statSync(root, { throwIfNoEntry: false }) ? readdirSync(root) : []) {
        if (active.has(name)) continue;
        const at = statSync(join(root, name), { throwIfNoEntry: false })?.mtimeMs;
        if (at === undefined || Date.now() - at <= KEPT_MS) continue;
        beforeRemove?.(join(root, name));
        rmSync(join(root, name), { recursive: true, force: true });
      }
    },
    /** A new, empty transfer. */
    begin() {
      const id = randomUUID();
      mkdirSync(folder(id), { recursive: true });
      active.add(id);
      return id;
    },
    discard(id: string) {
      rmSync(folder(id), { recursive: true, force: true });
      active.delete(id);
      touched.delete(id);
    },
    /** Marks a transfer in use now (a download that has begun), whatever its age. */
    inUse(id: string) {
      touched.delete(id);
      touch(id);
    },
    /** Chunks passed on, the transfer marked in use while they come. */
    async *touching(id: string, chunks: AsyncIterable<Uint8Array>) {
      for await (const chunk of chunks) {
        touch(id);
        yield chunk;
      }
    },
    /** Room for `bytes` more on the disk of `dir` — the data root's margin left free —, else ENOSPC. */
    room(dir: string, bytes: number, margin = dataRootMargin) {
      const disk = diskAt(dir);
      if (disk && disk.free < bytes + margin(disk.size)) throw noSpace();
    },
    /** A file of `length` bytes received into `file` of the transfer, the room checked for `need`
     *  first; false when more comes. */
    async receive(
      id: string,
      file: string,
      body: AsyncIterable<Uint8Array>,
      length: number,
      need: number,
    ) {
      self.room(root, need);
      return (
        (await writeChunks(join(folder(id), file), self.touching(id, body), length)) !== undefined
      );
    },
    /** A stream written whole to a file — its owner's only — (beside it, then renamed), its disk
     *  checked for `bytes` first. */
    async save(stream: ReadableStream<Uint8Array>, file: string, bytes: number) {
      self.room(dirname(file), bytes, () => FILE_MARGIN);
      const part = `${file}.part`;
      try {
        rmSync(part, { force: true });
        await writeChunks(part, stream, Number.POSITIVE_INFINITY, 0o600);
        renameSync(part, file);
      } catch (error) {
        rmSync(part, { force: true });
        throw error;
      }
    },
    /** The entries as a zip (course-kit's), streamed; the transfer goes when the stream ends or is
     *  cancelled. */
    zip(id: string, entries: ZipSource[]) {
      self.inUse(id);
      async function* chunks() {
        try {
          for await (const chunk of zipStream(entries)) {
            touch(id);
            yield chunk;
          }
        } finally {
          self.discard(id);
        }
      }
      const it = chunks();
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await it.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          await it.return(undefined);
          // A stream cancelled before it began never ran the generator's `finally`.
          self.discard(id);
        },
      });
    },
  };
  return self;
}
export type TransferFolders = ReturnType<typeof transferFolders>;
