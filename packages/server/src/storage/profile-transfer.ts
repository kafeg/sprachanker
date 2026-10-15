// Profile files on disk: each export or import in a transfer folder of its own,
// `profiles/.transfers/<id>/` (transfers.ts). An export's snapshot — the database copied whole by the
// runtime and its secrets emptied, the recordings linked — streamed as a zip of stored entries
// (course-kit's zip); a received file read by its zip directory, unpacked streaming and hashed, its
// database checked (profile-db.ts, by the runtime: a Worker on the desktop) and moved into place.
import {
  bytesEntry,
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
import { PROFILE_FILE_MAX_FILES, ProfileFilePath } from "@sprachanker/schema";
import type { ProfileFileEntry, TransferFiles } from "../services/profile-transfer.ts";
import { editEndpoints, type Settled, type SqlDb } from "./profile-db.ts";
import { type DataRoot, under } from "./root.ts";
import { type TransferOptions, transferFolders } from "./transfers.ts";

/** What a profile file needs of the runtime's SQLite. */
export interface ProfileSql {
  /** The migrations this app's profile databases may have, in order. */
  migrations: readonly string[];
  /** A whole, consistent copy of a profile's database written to `file` (the live one goes on). */
  copy(profileId: string, file: string): void | Promise<void>;
  /** A database file opened to be changed (the copy: its secrets emptied). */
  open(file: string): SqlDb;
  /** A received database made ready (profile-db.ts), apart from the server's work where the runtime
   *  can; "damaged" once it takes longer than `ms`. */
  settle(file: string, endpoints: readonly string[], ms: number): Promise<Settled>;
}

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
export function profileTransferFiles(
  data: DataRoot,
  sql: ProfileSql,
  options: TransferOptions & { settleMs?: number } = {},
): TransferFiles {
  const { fs } = data;
  const root = under(data, "profiles", ".transfers");
  const t = transferFolders(fs, root, options);
  const unpacked = (id: string) => joinPath(t.folder(id), "profile");
  const received = (id: string) => joinPath(t.folder(id), "received");
  /** Each snapshot's files with their size and CRC-32 (the zip's), until it is streamed. */
  const sums = new Map<string, Map<string, { size: number; crc32: number }>>();
  const discard = (id: string) => {
    sums.delete(id);
    t.discard(id);
  };
  /** The entries of a profile file, its manifest apart; each name allowed and once. */
  const entriesOf = (id: string, file: string) => t.once(id, file, () => parseEntries(file));
  const parseEntries = (file: string) => {
    const entries = zipEntries(fs, file, ZIP_LIMITS);
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
        return fileEntry(fs, path, joinPath(unpacked(id), path), sum);
      }),
    ];
  };

  const self: TransferFiles = {
    migrations: sql.migrations,
    sweep: t.sweep,
    begin: t.begin,
    async snapshot(profileId) {
      const folder = under(data, "profiles", profileId);
      const source = joinPath(folder, "profile.sqlite");
      const id = t.begin();
      try {
        const copy = joinPath(unpacked(id), "profile.sqlite");
        fs.mkdir(dirName(copy));
        const wal = fs.stat(`${source}-wal`)?.size ?? 0;
        t.room(root, (fs.stat(source)?.size ?? 0) + wal);
        await sql.copy(profileId, copy);
        // The copy without the sealed API keys — emptied, then vacuumed so their pages go too — nor a
        // user name or password in an endpoint's address.
        const db = sql.open(copy);
        let migrations: string[];
        let apiKeys: string[];
        const endpointLogins: string[] = [];
        try {
          migrations = db
            .all("SELECT tag FROM _migrations ORDER BY rowid")
            .map((r) => String(r.tag));
          apiKeys = db
            .all("SELECT provider_id FROM secrets ORDER BY 1")
            .map((r) => String(r.provider_id));
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
        const recordings = joinPath(folder, "recordings");
        const names = fs.list(recordings).filter((name) => RECORDING.test(name));
        if (names.length) fs.mkdir(joinPath(unpacked(id), "recordings"));
        for (const name of names.sort()) {
          const from = joinPath(recordings, name);
          const to = joinPath(unpacked(id), "recordings", name);
          linkOrCopy(fs, from, to);
        }
        const files: ProfileFileEntry[] = [];
        const summed = new Map<string, { size: number; crc32: number }>();
        for (const path of ["profile.sqlite", ...names.map((n) => `recordings/${n}`)]) {
          const { sha256, size, crc32 } = await fileSums(fs, joinPath(unpacked(id), path));
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
        manifest: entryText(fs, file, entries.manifest),
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
        const written = await writeChunks(
          fs,
          joinPath(unpacked(id), e.name),
          entryStream(fs, file, e),
          e.size,
        );
        // The first file not as listed ends it.
        const want = listed.get(e.name);
        if (!written || written.size !== want?.size || written.sha256 !== want.sha256) return false;
      }
      return true;
    },
    settle: (id, endpoints) =>
      sql.settle(
        joinPath(unpacked(id), "profile.sqlite"),
        endpoints,
        options.settleMs ?? SETTLE_MS,
      ),
    unfinished(known) {
      if (!t.sweeps()) return;
      const profiles = under(data, "profiles");
      for (const name of fs.list(profiles)) {
        const mark = joinPath(profiles, name, ADOPTING);
        if (name.startsWith(".") || !fs.stat(mark)) continue;
        fs.remove(known(name) ? mark : joinPath(profiles, name));
      }
    },
    adopt(id, profileId, register) {
      const target = under(data, "profiles", profileId);
      if (fs.stat(target)) throw new Error(`${target} exists`);
      // Marked until its row exists: a process stopped in between leaves no profile without one.
      fs.writeFile(joinPath(unpacked(id), ADOPTING), "");
      fs.rename(unpacked(id), target);
      let made: ReturnType<typeof register>;
      try {
        made = register();
      } catch (error) {
        // Back into the transfer, which goes with it.
        fs.rename(target, unpacked(id));
        throw error;
      }
      fs.remove(joinPath(target, ADOPTING));
      return made;
    },
    discard,
  };
  return self;
}
