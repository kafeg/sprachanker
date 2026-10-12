// The learner's recordings (08; 05): audio as the browser captured it, kept in the profile's
// `recordings/` folder by id and referenced from the answers that hold them. Saved, served, counted,
// removed — all of them on request (Settings → Speech), or those of the runs a progress reset deletes.
import { decodeTime, ulid } from "ulid";
import { ServiceError } from "../errors.ts";
import type { RecordingFiles } from "./profiles.ts";

/** The formats browsers record in (Safari: MP4/AAC; Chrome, Firefox: WebM or Ogg with Opus). */
const EXTENSIONS: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};
/** A recording is a phrase or an answer: 5 MB is minutes of compressed speech. */
export const RECORDING_MAX_BYTES = 5_000_000;
const NAME = /^([0-9A-Z]{26})\.([a-z0-9]+)$/;

export function createRecordings(files: RecordingFiles, now: () => number) {
  const nameOf = (id: string) => files.list().find((f) => NAME.exec(f.name)?.[1] === id)?.name;
  return {
    /** Keeps a recording; its type is the browser's (parameters like `;codecs=opus` aside). */
    async save(bytes: Uint8Array, type: string) {
      const ext = EXTENSIONS[type.split(";")[0]?.trim().toLowerCase() ?? ""];
      if (!ext) throw new ServiceError("unsupported_audio", 415);
      if (!bytes.length) throw new ServiceError("empty_recording");
      if (bytes.length > RECORDING_MAX_BYTES) throw new ServiceError("recording_too_large", 413);
      const id = ulid(now());
      await files.write(`${id}.${ext}`, bytes);
      return { id };
    },

    /** A recording to play, with its file name (its type); 404 when it is gone (deleted, or never kept). */
    file(id: string) {
      const name = nameOf(id);
      const blob = name && files.read(name);
      if (!name || !blob) throw new ServiceError("no_such_recording", 404);
      return { blob, name };
    },

    /** How many recordings are kept, their size, and when the oldest was made (ids are ULIDs: one
     *  made before it is gone — all of them deleted —, so a page names it deleted without asking). */
    stats() {
      const list = files.list().filter((f) => NAME.test(f.name));
      const times = list.map((f) => decodeTime(f.name.slice(0, 26)));
      return {
        count: list.length,
        bytes: list.reduce((n, f) => n + f.size, 0),
        oldest: times.length ? Math.min(...times) : null,
      };
    },

    /**
     * Removes the recordings no answer holds (`inUse`) made before `before`: takes recorded again or
     * never answered with, and those not to be kept. A newer one may belong to an answer still on its
     * way. Returns how many went.
     */
    removeUnused(inUse: ReadonlySet<string>, before: number) {
      const unused = files
        .list()
        .flatMap((f) => NAME.exec(f.name)?.[1] ?? [])
        .filter((id) => !inUse.has(id) && decodeTime(id) < before);
      return unused.length ? this.remove(unused) : 0;
    },

    /** Removes a take nothing was heard in (kept while it was heard), unless an answer holds it
     *  (`inUse`); whether it went. */
    forget(id: string, inUse: ReadonlySet<string>) {
      return !inUse.has(id) && this.remove([id]) > 0;
    },

    /** Removes some recordings (those of runs deleted), or all of them. */
    remove(ids?: string[]) {
      const names = files
        .list()
        .map((f) => f.name)
        .filter((name) => {
          const id = NAME.exec(name)?.[1];
          return id !== undefined && (!ids || ids.includes(id));
        });
      files.remove(names);
      return names.length;
    },
  };
}
export type Recordings = ReturnType<typeof createRecordings>;
