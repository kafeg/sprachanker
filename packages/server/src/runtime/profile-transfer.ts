// Profile files on disk (05, "Profile file"): each export or import in a transfer folder of its own,
// `profiles/.transfers/<id>/` (transfers.ts). An export's snapshot — the database copied with
// `VACUUM INTO` and its secrets emptied, the recordings linked — streamed as a zip of stored entries
// (course-kit's zip); a received file read by its zip directory, unpacked streaming and hashed, its
// database checked and moved into place.
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  bytesEntry,
  entryBytes,
  entryStream,
  fileEntry,
  fileSums,
  linkOrCopy,
  writeChunks,
  zipEntries,
  zipLength,
  zipLimits,
} from "@sprachanker/course-kit";
import { PROFILE_FILE_MAX_FILES, ProfileFilePath } from "@sprachanker/schema";
import type { ProfileFileEntry, TransferFiles } from "../services/profile-transfer.ts";
import { BUSY_MS, profileDbFile, profileMigrationTags, vacuumInto } from "./bun.ts";
import { editEndpoints, type Settled } from "./profile-db.ts";
import { type TransferOptions, transferFolders } from "./transfers.ts";

const MANIFEST = "manifest.json";
/** A manifest is small: a line per file. */
const MANIFEST_MAX = 64 * 1024 * 1024;
/** In a profile's folder moved into place by an import, until its row is made. */
const ADOPTING = ".importing";
const RECORDING = /^[0-9A-HJKMNP-TV-Z]{26}\.[a-z0-9]{1,8}$/;
/** A database made ready for longer than this is refused (a 4 GB one takes minutes). */
const SETTLE_MS = 30 * 60_000;
/** A profile file's zip: its files and manifest, names short (`recordings/<ulid>.<ext>`). */
const ZIP_LIMITS = zipLimits(PROFILE_FILE_MAX_FILES + 1, 256, 64);
/** The Worker that makes an imported profile's database ready, from sources; the compiled binary names its own
 *  (apps/cli/scripts/build.ts adds it as an entry). */
export const PROFILE_DB_WORKER = join(import.meta.dir, "profile-db-worker.ts");

export function profileTransferFiles(
  dataRoot: string,
  options: TransferOptions & {
    /** The Worker of profile-db-worker.ts: the compiled binary's own, else PROFILE_DB_WORKER. */
    worker?: string;
    settleMs?: number;
  } = {},
): TransferFiles {
  const root = join(dataRoot, "profiles", ".transfers");
  const t = transferFolders(root, options);
  const unpacked = (id: string) => join(t.folder(id), "profile");
  const received = (id: string) => join(t.folder(id), "received");
  /** Each snapshot's files with their size and CRC-32 (the zip's), until it is streamed. */
  const sums = new Map<string, Map<string, { size: number; crc32: number }>>();
  const discard = (id: string) => {
    sums.delete(id);
    t.discard(id);
  };
  /** The entries of a profile file, its manifest apart; each name allowed and once. */
  const entriesOf = (id: string, file: string) => t.once(id, file, () => parseEntries(file));
  const parseEntries = (file: string) => {
    const entries = zipEntries(file, ZIP_LIMITS);
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
  /** The zip's entries: the manifest first, then the snapshot's files in the order given. */
  const zipOf = (id: string, manifest: string, paths: string[]) => {
    const of = sums.get(id);
    return [
      bytesEntry(MANIFEST, new TextEncoder().encode(manifest)),
      ...paths.map((path) => {
        const sum = of?.get(path);
        if (!sum) throw new Error(`${path} is not in transfer ${id}`);
        return fileEntry(path, join(unpacked(id), path), sum);
      }),
    ];
  };

  const self: TransferFiles = {
    migrations: profileMigrationTags,
    sweep: t.sweep,
    begin: t.begin,
    async snapshot(profileId) {
      const source = profileDbFile(dataRoot, profileId);
      const id = t.begin();
      try {
        const copy = join(unpacked(id), "profile.sqlite");
        mkdirSync(dirname(copy), { recursive: true });
        const wal = statSync(`${source}-wal`, { throwIfNoEntry: false })?.size ?? 0;
        t.room(root, statSync(source).size + wal);
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
          linkOrCopy(from, to);
        }
        const files: ProfileFileEntry[] = [];
        const summed = new Map<string, { size: number; crc32: number }>();
        for (const path of ["profile.sqlite", ...names.map((n) => `recordings/${n}`)]) {
          const { sha256, size, crc32 } = await fileSums(join(unpacked(id), path));
          files.push({ path, size, sha256 });
          summed.set(path, { size, crc32 });
        }
        sums.set(id, summed);
        return { id, files, migrations, apiKeys, endpointLogins: endpointLogins.sort() };
      } catch (error) {
        discard(id);
        throw error;
      }
    },
    bytes: (id, manifest, paths) => zipLength(zipOf(id, manifest, paths)),
    stream(id, manifest, paths) {
      const entries = zipOf(id, manifest, paths);
      sums.delete(id);
      return t.zip(id, entries);
    },
    save: t.save,
    // The file and what it unpacks to.
    receive: (id, body, length) => t.receive(id, "received", body, length, 2 * length),
    read(id, file = received(id)) {
      const entries = entriesOf(id, file);
      if (!entries) return undefined;
      return {
        manifest: entryBytes(file, entries.manifest).toString("utf8"),
        entries: entries.others.map((e) => ({ path: e.name, size: e.size })),
      };
    },
    async unpack(id, listed, file = received(id)) {
      const entries = entriesOf(id, file);
      if (!entries) return false;
      // Its files, and the copy of its database made before it is migrated.
      const database = entries.others.find((e) => e.name === "profile.sqlite")?.size ?? 0;
      t.room(
        root,
        entries.others.reduce((n, e) => n + e.size, database),
      );
      for (const e of entries.others) {
        const written = await writeChunks(join(unpacked(id), e.name), entryStream(file, e), e.size);
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
      if (!t.sweeps()) return;
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
