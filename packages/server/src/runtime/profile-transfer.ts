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
  utimesSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ProfileFilePath } from "@sprachanker/schema";
import { Zip, ZipPassThrough } from "fflate";
import type { ProfileFileEntry, TransferFiles } from "../services/profile-transfer.ts";
import { BUSY_MS, profileDbFile, profileMigrationTags, vacuumInto } from "./bun.ts";
import { editEndpoints, type Settled } from "./profile-db.ts";

const MANIFEST = "manifest.json";
/** A manifest is small: a line per file. */
const MANIFEST_MAX = 64 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A transfer left this long (an export never downloaded, an import cut short) goes. */
const KEPT_MS = 60 * 60_000;
/** How often a transfer in use marks its folder's time (another process's sweep goes by it). */
const TOUCH_MS = 60_000;
/** In a profile's folder moved into place by an import, until its row is made. */
const ADOPTING = ".importing";
/** Room a transfer leaves free on the data root's disk beyond what it writes: the larger of 1 GB and
 *  5 % of the disk (the server and the learners' own work go on beside it). */
const dataRootMargin = (diskBytes: number) => Math.max(1024 ** 3, 0.05 * diskBytes);
/** Room left free beyond a file written elsewhere (a profile file saved where the command was told). */
const FILE_MARGIN = 16 * 1024 * 1024;
const RECORDING = /^[0-9A-HJKMNP-TV-Z]{26}\.[a-z0-9]{1,8}$/;
/** A database made ready for longer than this is refused (a 4 GB one takes minutes). */
const SETTLE_MS = 30 * 60_000;
/** The Worker that makes an imported database ready, from sources; the compiled binary names its own
 *  (apps/cli/scripts/build.ts adds it as an entry). */
export const PROFILE_DB_WORKER = join(import.meta.dir, "profile-db-worker.ts");

/** A full disk, found before writing: the same error a write that runs out of room gives. */
const noSpace = () => Object.assign(new Error("not enough free space"), { code: "ENOSPC" });

/** The disk of `dir`: the bytes free for this user, and its size; null when the system does not say. */
function diskOf(dir: string): Disk | null {
  try {
    const disk = statfsSync(dir);
    return { free: disk.bavail * disk.bsize, size: disk.blocks * disk.bsize };
  } catch {
    return null;
  }
}
type Disk = { free: number; size: number };

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

/** Each field of an entry — its name, extra field, comment — is short in a profile file. */
const FIELD_MAX = 256;
/** The central directory read at once: a profile file's is small (a line a file). */
const DIRECTORY_MAX = 16 * 1024 * 1024;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;

/**
 * A zip's entries by its central directory: each stored entry's name, where its data starts and its
 * size. Nothing it says is trusted further than it is checked: the end record runs to the end of the
 * file, one disk, the directory right before it and no larger than its entries need; each entry
 * stored (not compressed, not encrypted), short fields, its local header the same (name, flags, sizes
 * — or none, with a data descriptor), and the entries in order, none overlapping another or the
 * directory (so their sizes add up to less than the file). Undefined when it is no such zip (ZIP64
 * neither).
 */
function zipEntries(file: string) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const at = (bytes: number, position: number) => {
      const buffer = Buffer.alloc(bytes);
      return readSync(fd, buffer, 0, bytes, position) === bytes ? buffer : undefined;
    };
    const tailBytes = Math.min(size, END_RECORD + 0xffff);
    const tailAt = size - tailBytes;
    const tail = at(tailBytes, tailAt);
    if (!tail) return undefined;
    let end = -1;
    for (let i = tailBytes - END_RECORD; i >= 0 && end < 0; i--)
      if (
        tail.readUInt32LE(i) === 0x06054b50 &&
        i + END_RECORD + tail.readUInt16LE(i + 20) === tailBytes
      )
        end = i;
    if (end < 0) return undefined;
    const count = tail.readUInt16LE(end + 10);
    const dirBytes = tail.readUInt32LE(end + 12);
    const dirAt = tail.readUInt32LE(end + 16);
    const oneDisk =
      tail.readUInt16LE(end + 4) === 0 &&
      tail.readUInt16LE(end + 6) === 0 &&
      tail.readUInt16LE(end + 8) === count;
    if (
      !oneDisk ||
      dirAt + dirBytes !== tailAt + end ||
      dirBytes > Math.min(DIRECTORY_MAX, count * (CENTRAL_HEADER + 3 * FIELD_MAX))
    )
      return undefined;
    const dir = at(dirBytes, dirAt);
    if (!dir) return undefined;
    const entries: Array<{ name: string; start: number; size: number }> = [];
    // Where the next entry may start: after the one before it, data descriptor and all.
    let free = 0;
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + CENTRAL_HEADER > dirBytes || dir.readUInt32LE(p) !== 0x02014b50) return undefined;
      const flags = dir.readUInt16LE(p + 8);
      const method = dir.readUInt16LE(p + 10);
      const stored = dir.readUInt32LE(p + 20);
      const length = dir.readUInt32LE(p + 24);
      const fields = [p + 28, p + 30, p + 32].map((f) => dir.readUInt16LE(f));
      const local = dir.readUInt32LE(p + 42);
      const [nameBytes = 0, extraBytes = 0, commentBytes = 0] = fields;
      if (fields.some((f) => f > FIELD_MAX)) return undefined;
      const name = dir.subarray(p + CENTRAL_HEADER, p + CENTRAL_HEADER + nameBytes);
      p += CENTRAL_HEADER + nameBytes + extraBytes + commentBytes;
      if (p > dirBytes || flags & 1 || method !== 0 || stored !== length || local < free)
        return undefined;
      const head = at(LOCAL_HEADER + nameBytes, local);
      if (
        head?.readUInt32LE(0) !== 0x04034b50 ||
        head.readUInt16LE(6) !== flags ||
        head.readUInt16LE(8) !== 0 ||
        head.readUInt16LE(26) !== nameBytes ||
        head.readUInt16LE(28) > FIELD_MAX ||
        !head.subarray(LOCAL_HEADER).equals(name)
      )
        return undefined;
      // Sizes in the local header, or none there and a data descriptor after the data.
      const described = (flags & 8) !== 0;
      const sizes = [head.readUInt32LE(18), head.readUInt32LE(22)];
      if (!sizes.every((s) => s === length || (described && s === 0))) return undefined;
      const start = local + LOCAL_HEADER + nameBytes + head.readUInt16LE(28);
      free = start + length;
      if (described) free += at(4, free)?.readUInt32LE(0) === 0x08074b50 ? 16 : 12;
      if (free > dirAt) return undefined;
      entries.push({ name: name.toString("utf8"), start, size: length });
    }
    return p === dirBytes ? entries : undefined;
  } finally {
    closeSync(fd);
  }
}

export function profileTransferFiles(
  dataRoot: string,
  options: {
    disk?: (dir: string) => Disk | null;
    /** The Worker of profile-db-worker.ts: the compiled binary's own, else PROFILE_DB_WORKER. */
    worker?: string;
    settleMs?: number;
    /** Whether this process may sweep: not the command line while a server runs on the data root
     *  (its transfers are the server's). */
    sweeps?: () => boolean;
  } = {},
): TransferFiles {
  const diskAt = options.disk ?? diskOf;
  /** This process's transfers in use: never swept. */
  const active = new Set<string>();
  /** A transfer's folder marked as in use for another process's sweep (its time), at most a minute
   *  apart. */
  const touched = new Map<string, number>();
  const touch = (id: string) => {
    if (Date.now() - (touched.get(id) ?? 0) < TOUCH_MS) return;
    touched.set(id, Date.now());
    const now = new Date();
    try {
      utimesSync(folder(id), now, now);
    } catch {}
  };
  const root = join(dataRoot, "profiles", ".transfers");
  const folder = (id: string) => {
    if (!ID.test(id)) throw new Error(`bad transfer id ${id}`);
    return join(root, id);
  };
  const unpacked = (id: string) => join(folder(id), "profile");
  const received = (id: string) => join(folder(id), "received");
  /** Room for `bytes` more on the disk of `dir` (the data root's, unless `margin` says otherwise). */
  const room = (dir: string, bytes: number, margin = dataRootMargin) => {
    const disk = diskAt(dir);
    if (disk && disk.free < bytes + margin(disk.size)) throw noSpace();
  };
  const discard = (id: string) => {
    rmSync(folder(id), { recursive: true, force: true });
    active.delete(id);
    touched.delete(id);
  };
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
      if (options.sweeps && !options.sweeps()) return;
      for (const name of statSync(root, { throwIfNoEntry: false }) ? readdirSync(root) : []) {
        if (active.has(name)) continue;
        const at = statSync(join(root, name), { throwIfNoEntry: false })?.mtimeMs;
        if (at !== undefined && Date.now() - at > KEPT_MS)
          rmSync(join(root, name), { recursive: true, force: true });
      }
    },
    begin() {
      const id = randomUUID();
      mkdirSync(folder(id), { recursive: true });
      active.add(id);
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
        // The copy without the sealed API keys — emptied, then vacuumed so their pages go too — nor a
        // user name or password in an endpoint's address.
        const db = new Database(copy);
        let migrations: string[];
        let apiKeys: string[];
        const endpointLogins: string[] = [];
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
          editEndpoints(db, (endpoints) => {
            for (const [provider, address] of Object.entries(endpoints)) {
              const url = URL.parse(address);
              if (!url || (!url.username && !url.password)) continue;
              url.username = "";
              url.password = "";
              endpoints[provider] = url.href;
              endpointLogins.push(provider);
            }
            return endpoints;
          });
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
        return { id, files, migrations, apiKeys, endpointLogins: endpointLogins.sort() };
      } catch (error) {
        discard(id);
        throw error;
      }
    },
    stream(id, manifest, paths) {
      const base = unpacked(id);
      // In use from now (a download that has begun), whatever its age.
      touched.delete(id);
      touch(id);
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
              touch(id);
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
      room(dirname(file), bytes, () => FILE_MARGIN);
      const part = `${file}.part`;
      try {
        await writeChunks(part, stream);
        renameSync(part, file);
      } catch (error) {
        rmSync(part, { force: true });
        throw error;
      }
    },
    async receive(id, body, length) {
      // The file and what it unpacks to.
      room(root, 2 * length);
      async function* touching() {
        for await (const chunk of body) {
          touch(id);
          yield chunk;
        }
      }
      return (await writeChunks(received(id), touching(), length)) !== undefined;
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
    async unpack(id, listed, file = received(id)) {
      const entries = entriesOf(file);
      if (!entries) return false;
      room(
        root,
        entries.others.reduce((n, e) => n + e.size, 0),
      );
      for (const e of entries.others) {
        const stream = Bun.file(file)
          .slice(e.start, e.start + e.size)
          .stream();
        const written = await writeChunks(join(unpacked(id), e.name), stream, e.size);
        // The first file not as listed ends it.
        const want = listed.get(e.name);
        if (!written || written.size !== want?.size || written.sha256 !== want.sha256) return false;
      }
      return true;
    },
    settle(id, endpoints) {
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
        worker.postMessage({ file, endpoints });
      });
    },
    unfinished(known) {
      if (options.sweeps && !options.sweeps()) return;
      const profiles = join(dataRoot, "profiles");
      for (const name of statSync(profiles, { throwIfNoEntry: false })
        ? readdirSync(profiles)
        : []) {
        const mark = join(profiles, name, ADOPTING);
        if (name.startsWith(".") || !statSync(mark, { throwIfNoEntry: false })) continue;
        rmSync(known(name) ? mark : join(profiles, name), { recursive: true, force: true });
      }
    },
    adopt(id, profileId, register) {
      const target = join(dataRoot, "profiles", profileId);
      if (statSync(target, { throwIfNoEntry: false })) throw new Error(`${target} exists`);
      // Marked until its row exists: a process stopped in between leaves no profile without one.
      writeFileSync(join(unpacked(id), ADOPTING), "");
      renameSync(unpacked(id), target);
      let made: ReturnType<typeof register>;
      try {
        made = register();
      } catch (error) {
        // Back into the transfer, which goes with it.
        renameSync(target, unpacked(id));
        throw error;
      }
      rmSync(join(target, ADOPTING), { force: true });
      return made;
    },
    discard,
  };
  return self;
}
