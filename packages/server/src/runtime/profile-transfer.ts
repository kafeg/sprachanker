// Profile files on disk (05, "Profile file"): each export or import in a transfer folder of its own,
// `profiles/.transfers/<id>/`. An export's snapshot — the database copied with `VACUUM INTO` and its
// secrets emptied, the recordings linked — streamed as a zip of stored entries (fflate); a received
// file read by its zip directory (fflate's streaming reader scans stored data for signatures, which a
// recording may hold), unpacked streaming and hashed, its database checked and moved into place.
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ProfileFilePath } from "@sprachanker/schema";
import { Zip, ZipPassThrough } from "fflate";
import type { ProfileFileEntry, TransferFiles } from "../services/profile-transfer.ts";
import { BUSY_MS, profileDbFile, profileMigrationTags, vacuumInto } from "./bun.ts";
import type { Settled } from "./profile-db.ts";

const MANIFEST = "manifest.json";
/** A manifest is small: a line per file. */
const MANIFEST_MAX = 64 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A transfer left this long (an export never downloaded, an import cut short) goes. */
const KEPT_MS = 60 * 60_000;
/** Room kept free beyond what a transfer writes. */
const MARGIN = 16 * 1024 * 1024;
const RECORDING = /^[0-9A-HJKMNP-TV-Z]{26}\.[a-z0-9]{1,8}$/;
/** A database made ready for longer than this is refused (a 4 GB one takes minutes). */
const SETTLE_MS = 30 * 60_000;
/** The Worker that makes an imported database ready, from sources; the compiled binary names its own
 *  (apps/cli/scripts/build.ts adds it as an entry). */
export const PROFILE_DB_WORKER = join(import.meta.dir, "profile-db-worker.ts");

/** A full disk, found before writing: the same error a write that runs out of room gives. */
const noSpace = () => Object.assign(new Error("not enough free space"), { code: "ENOSPC" });

/** Bytes free for this user on the disk of `dir`; null when the system does not say. */
function diskFree(dir: string): number | null {
  try {
    const disk = statfsSync(dir);
    return disk.bavail * disk.bsize;
  } catch {
    return null;
  }
}

/** A file's sha256 and size, read as a stream. */
async function hashOf(file: string) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of Bun.file(file).stream()) {
    hash.update(chunk);
    size += chunk.byteLength;
  }
  return { sha256: hash.digest("hex"), size };
}

/** Chunks written to a file (made anew), hashed on the way; past `max` bytes it stops: false. */
async function writeChunks(file: string, chunks: AsyncIterable<Uint8Array>, max = Infinity) {
  mkdirSync(dirname(file), { recursive: true });
  const handle = await open(file, "w");
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of chunks) {
      size += chunk.byteLength;
      if (size > max) return undefined;
      hash.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), size };
}

/** A zip's entries by its central directory: each stored entry's name, where its data starts and its
 *  size; undefined when it is no zip this reads (no directory, an entry compressed, encrypted or
 *  past the directory, ZIP64). */
function zipEntries(file: string) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const at = (bytes: number, position: number) => {
      const buffer = Buffer.alloc(bytes);
      return readSync(fd, buffer, 0, bytes, position) === bytes ? buffer : undefined;
    };
    const tailBytes = Math.min(size, 22 + 0xffff);
    const tail = at(tailBytes, size - tailBytes);
    if (!tail) return undefined;
    let end = -1;
    for (let i = tailBytes - 22; i >= 0 && end < 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) end = i;
    if (end < 0) return undefined;
    const count = tail.readUInt16LE(end + 10);
    const dirBytes = tail.readUInt32LE(end + 12);
    const dirAt = tail.readUInt32LE(end + 16);
    const dir = dirAt + dirBytes <= size ? at(dirBytes, dirAt) : undefined;
    if (!dir) return undefined;
    const entries: Array<{ name: string; start: number; size: number }> = [];
    for (let n = 0, p = 0; n < count; n++) {
      if (p + 46 > dirBytes || dir.readUInt32LE(p) !== 0x02014b50) return undefined;
      const flags = dir.readUInt16LE(p + 8);
      const method = dir.readUInt16LE(p + 10);
      const stored = dir.readUInt32LE(p + 20);
      const length = dir.readUInt32LE(p + 24);
      const nameBytes = dir.readUInt16LE(p + 28);
      const local = dir.readUInt32LE(p + 42);
      const name = dir.toString("utf8", p + 46, p + 46 + nameBytes);
      p += 46 + nameBytes + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
      if (flags & 1 || method !== 0 || stored !== length) return undefined;
      const head = at(30, local);
      if (head?.readUInt32LE(0) !== 0x04034b50) return undefined;
      const start = local + 30 + (head.readUInt16LE(26) + head.readUInt16LE(28));
      if (start + length > dirAt) return undefined;
      entries.push({ name, start, size: length });
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

export function profileTransferFiles(
  dataRoot: string,
  options: {
    free?: (dir: string) => number | null;
    /** The Worker of profile-db-worker.ts: the compiled binary's own, else PROFILE_DB_WORKER. */
    worker?: string;
    settleMs?: number;
  } = {},
): TransferFiles {
  const free = options.free ?? diskFree;
  const root = join(dataRoot, "profiles", ".transfers");
  const folder = (id: string) => {
    if (!ID.test(id)) throw new Error(`bad transfer id ${id}`);
    return join(root, id);
  };
  const unpacked = (id: string) => join(folder(id), "profile");
  const received = (id: string) => join(folder(id), "received");
  const room = (dir: string, bytes: number) => {
    const left = free(dir);
    if (left !== null && left < bytes + MARGIN) throw noSpace();
  };
  const discard = (id: string) => rmSync(folder(id), { recursive: true, force: true });
  /** The entries of a profile file, its manifest apart; each name allowed and once. */
  const entriesOf = (file: string) => {
    const entries = zipEntries(file);
    if (!entries) return undefined;
    const names = new Set(entries.map((e) => e.name));
    const manifest = entries.find((e) => e.name === MANIFEST);
    const others = entries.filter((e) => e !== manifest);
    if (
      names.size !== entries.length ||
      !manifest ||
      manifest.size > MANIFEST_MAX ||
      others.some((e) => !ProfileFilePath.safeParse(e.name).success)
    )
      return undefined;
    return { manifest, others };
  };

  const self: TransferFiles = {
    migrations: profileMigrationTags,
    sweep() {
      for (const name of statSync(root, { throwIfNoEntry: false }) ? readdirSync(root) : []) {
        const at = statSync(join(root, name), { throwIfNoEntry: false })?.mtimeMs;
        if (at !== undefined && Date.now() - at > KEPT_MS)
          rmSync(join(root, name), { recursive: true, force: true });
      }
    },
    begin() {
      const id = randomUUID();
      mkdirSync(folder(id), { recursive: true });
      return id;
    },
    async snapshot(profileId) {
      const source = profileDbFile(dataRoot, profileId);
      const id = self.begin();
      try {
        const copy = join(unpacked(id), "profile.sqlite");
        mkdirSync(dirname(copy), { recursive: true });
        const wal = statSync(`${source}-wal`, { throwIfNoEntry: false })?.size ?? 0;
        room(root, statSync(source).size + wal);
        const live = new Database(source, { readwrite: true });
        try {
          live.exec(`PRAGMA busy_timeout = ${BUSY_MS}`);
          vacuumInto(live, copy);
        } finally {
          live.close();
        }
        // The copy without the sealed API keys: emptied, then vacuumed so their pages go too.
        const db = new Database(copy);
        let migrations: string[];
        let apiKeys: string[];
        try {
          migrations = db
            .query<{ tag: string }, []>("SELECT tag FROM _migrations ORDER BY rowid")
            .all()
            .map((r) => r.tag);
          apiKeys = db
            .query<{ provider_id: string }, []>("SELECT provider_id FROM secrets ORDER BY 1")
            .all()
            .map((r) => r.provider_id);
          db.exec("DELETE FROM secrets");
          db.exec("VACUUM");
          db.exec("PRAGMA journal_mode = DELETE");
        } finally {
          db.close();
        }
        // The recordings as they are now: linked (a take deleted meanwhile stays in the file), copied
        // where the disk has no hard links.
        const recordings = join(dirname(source), "recordings");
        const names = statSync(recordings, { throwIfNoEntry: false })?.isDirectory()
          ? readdirSync(recordings).filter((name) => RECORDING.test(name))
          : [];
        if (names.length) mkdirSync(join(unpacked(id), "recordings"));
        for (const name of names.sort()) {
          const from = join(recordings, name);
          const to = join(unpacked(id), "recordings", name);
          try {
            linkSync(from, to);
          } catch {
            copyFileSync(from, to);
          }
        }
        const files: ProfileFileEntry[] = [];
        for (const path of ["profile.sqlite", ...names.map((n) => `recordings/${n}`)])
          files.push({ path, ...(await hashOf(join(unpacked(id), path))) });
        return { id, files, migrations, apiKeys };
      } catch (error) {
        discard(id);
        throw error;
      }
    },
    stream(id, manifest, paths) {
      const base = unpacked(id);
      async function* chunks() {
        const queue: Uint8Array[] = [];
        let failed: Error | undefined;
        const zip = new Zip((error, chunk) => {
          if (error) failed = error;
          else queue.push(chunk);
        });
        const take = () => {
          if (failed) throw failed;
          return queue.splice(0);
        };
        try {
          const head = new ZipPassThrough(MANIFEST);
          zip.add(head);
          head.push(new TextEncoder().encode(manifest), true);
          yield* take();
          for (const path of paths) {
            const entry = new ZipPassThrough(path);
            zip.add(entry);
            for await (const chunk of Bun.file(join(base, path)).stream()) {
              entry.push(chunk);
              yield* take();
            }
            entry.push(new Uint8Array(0), true);
            yield* take();
          }
          zip.end();
          yield* take();
        } finally {
          discard(id);
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
          discard(id);
        },
      });
    },
    async save(stream, file, bytes) {
      room(dirname(file), bytes);
      const part = `${file}.part`;
      try {
        await writeChunks(part, stream);
        renameSync(part, file);
      } catch (error) {
        rmSync(part, { force: true });
        throw error;
      }
    },
    async receive(id, body, max, announced) {
      // The file and what it unpacks to.
      if (announced !== undefined) room(root, 2 * announced);
      return (await writeChunks(received(id), body, max)) !== undefined;
    },
    read(id, file = received(id)) {
      const entries = entriesOf(file);
      if (!entries) return undefined;
      const { manifest, others } = entries;
      const fd = openSync(file, "r");
      try {
        const buffer = Buffer.alloc(manifest.size);
        readSync(fd, buffer, 0, manifest.size, manifest.start);
        return {
          manifest: buffer.toString("utf8"),
          entries: others.map((e) => ({ path: e.name, size: e.size })),
        };
      } finally {
        closeSync(fd);
      }
    },
    async unpack(id, file = received(id)) {
      const entries = entriesOf(file);
      if (!entries) return [];
      room(
        root,
        entries.others.reduce((n, e) => n + e.size, 0),
      );
      const out: ProfileFileEntry[] = [];
      for (const e of entries.others) {
        const stream = Bun.file(file)
          .slice(e.start, e.start + e.size)
          .stream();
        const written = await writeChunks(join(unpacked(id), e.name), stream);
        if (written) out.push({ path: e.name, ...written });
      }
      return out;
    },
    settle(id) {
      const file = join(unpacked(id), "profile.sqlite");
      const worker = new Worker(options.worker ?? PROFILE_DB_WORKER);
      return new Promise<Settled>((resolve) => {
        const done = (settled: Settled) => {
          clearTimeout(timer);
          // A worker held inside SQLite itself is not stopped by this; nothing of the file's own SQL
          // runs there (profile-db.ts), so only a fault of SQLite's could hold it.
          void worker.terminate();
          resolve(settled);
        };
        const timer = setTimeout(() => done("damaged"), options.settleMs ?? SETTLE_MS);
        worker.onmessage = (event: MessageEvent<Settled>) => done(event.data);
        worker.onerror = () => done("damaged");
        worker.postMessage({ file });
      });
    },
    adopt(id, profileId, register) {
      const target = join(dataRoot, "profiles", profileId);
      if (statSync(target, { throwIfNoEntry: false })) throw new Error(`${target} exists`);
      renameSync(unpacked(id), target);
      try {
        return register();
      } catch (error) {
        // Back into the transfer, which goes with it.
        renameSync(target, unpacked(id));
        throw error;
      }
    },
    discard,
  };
  return self;
}
