// The profiles' folders on the phone as the server's ProfileFiles: profiles/<id>/profile.sqlite
// opened through sql.js (db.ts; every profile there is opened at the start, as the server's
// `open` is synchronous), its recordings beside it (played by the native side by id).
import {
  type MediaBlob,
  type ProfileDb,
  type ProfileFiles,
  profileMigrations,
  profileSchema,
  type RecordingFiles,
} from "@sprachanker/server/portable";
import { drizzle } from "drizzle-orm/sql-js";
import { makeDb, openDb } from "./db.ts";
import type { Files } from "./files.ts";
import { NativeFile } from "./host.ts";

type Opened = ReturnType<typeof makeDb>;

const dbFile = (id: string) => `profiles/${id}/profile.sqlite`;

export async function profileFiles(
  files: Files,
): Promise<ProfileFiles & { live(id: string): Uint8Array | undefined }> {
  const opened = new Map<string, { sqlite: Opened; db: ProfileDb }>();
  const take = (id: string, sqlite: Opened) => {
    const entry = { sqlite, db: drizzle(sqlite.db, { schema: profileSchema }) as ProfileDb };
    opened.set(id, entry);
    return entry;
  };
  for (const id of files.fs.dirs(files.abs("profiles")))
    if (files.has(dbFile(id))) take(id, await openDb(files, dbFile(id), profileMigrations));

  return {
    exists: (id) => opened.has(id) || files.has(dbFile(id)),
    // A new profile's database: made in memory at once, written a moment later; one put there
    // since the start (a profile file imported) read as it is, where the files answer at once.
    open: (id) =>
      (
        opened.get(id) ??
        take(id, makeDb(files, dbFile(id), profileMigrations, files.readNow?.(dbFile(id))))
      ).db,
    live: (id) => opened.get(id)?.sqlite.snapshot(),
    remove(id) {
      const entry = opened.get(id);
      opened.delete(id);
      void (async () => {
        await entry?.sqlite.close();
        await files.remove(`profiles/${id}`);
      })();
    },
    recordings: (id) => recordingFiles(files, `profiles/${id}/recordings`),
  };
}

/** A profile's recordings folder: names checked by the service (`<ulid>.<ext>`); the takes of this
 *  run kept in memory to be read back, older ones played from the files by the native side. */
function recordingFiles(files: Files, dir: string): RecordingFiles {
  const kept = new Map<string, Blob>();
  const file = (name: string) => {
    if (name.includes("/")) throw new Error(`bad recording name ${name}`);
    return `${dir}/${name}`;
  };
  return {
    async write(name, bytes) {
      await files.write(file(name), bytes);
      kept.set(name, new Blob([bytes as Uint8Array<ArrayBuffer>]));
    },
    // One played on another device: sent from its file by the native side.
    read: (name) =>
      (kept.get(name) ??
        (files.has(file(name))
          ? new NativeFile({ file: files.abs(file(name)) }, () => files.read(file(name)))
          : undefined)) as MediaBlob | undefined,
    list: () =>
      files.fs
        .files(files.abs(dir))
        .map((name) => ({ name, size: files.fs.stat(files.abs(file(name)))?.size ?? 0 })),
    remove(names) {
      for (const name of names) {
        kept.delete(name);
        void files.remove(file(name));
      }
    },
  };
}
