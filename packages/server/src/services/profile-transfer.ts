// A profile moved between one's own machines as one file (05, "Profile file"): exported — a
// consistent copy of its database without its secrets, its recordings and a manifest, streamed as a
// zip — and imported, always as a new profile: every file checked against the manifest, a database
// from a newer app refused, an older one migrated forward, all or nothing. The files themselves are
// the runtime's (TransferFiles).
import {
  type ContentUsed,
  PROFILE_FILE_EXTENSION,
  PROFILE_FILE_FORMAT,
  PROFILE_FILE_MAX_BYTES,
  PROFILE_FILE_VERSION,
  ProfileManifest,
} from "@sprachanker/schema";
import { ulid } from "ulid";
import { ServiceError } from "../errors.ts";
import { createOnce } from "../once.ts";
import type { CardStore } from "./card-store.ts";
import { type Content, courseTitle } from "./content.ts";
import { EDITABLE_ENDPOINTS } from "./llm.ts";
import type { Profiles } from "./profiles.ts";
import type { RunStore } from "./run-store.ts";

/** A file of a profile file besides its manifest, as listed in the manifest. */
export interface ProfileFileEntry {
  path: string;
  size: number;
  sha256: string;
}

/**
 * Profile files on disk (runtime adapter): each export or import works in a transfer folder of its own
 * (`profiles/.transfers/<id>/`), removed when it ends. A full disk is an error with code `ENOSPC`,
 * also when the free space is found too small before writing.
 */
export interface TransferFiles {
  /** The migrations this app's profile databases may have, in order. */
  migrations: readonly string[];
  /** Transfers an hour old go: an export never downloaded, an import cut short. */
  sweep(): void;
  /** A consistent copy of a profile in a new transfer: its database (`VACUUM INTO`, the secrets
   *  emptied, a user name or password taken out of an endpoint's address) and its recordings, each
   *  file with its size and hash; the migrations the copy has, the providers whose API keys were
   *  emptied and those whose endpoint lost its login. */
  snapshot(profileId: string): Promise<{
    id: string;
    files: ProfileFileEntry[];
    migrations: string[];
    apiKeys: string[];
    endpointLogins: string[];
  }>;
  /** A snapshot as a profile file: `manifest.json` first, then its files in the order given (stored
   *  entries); the transfer goes when the stream ends or is cancelled. */
  stream(id: string, manifest: string, paths: string[]): ReadableStream<Uint8Array>;
  /** A stream written whole to a file (beside it, then renamed), its disk checked for `bytes` first. */
  save(stream: ReadableStream<Uint8Array>, file: string, bytes: number): Promise<void>;
  /** A new, empty transfer. */
  begin(): string;
  /** A profile file of `length` bytes received into the transfer, streamed to disk, the free space
   *  checked for it first; false when more comes. */
  receive(id: string, body: AsyncIterable<Uint8Array>, length: number): Promise<boolean>;
  /** A profile file read by its zip directory — the one received, or `file` on disk: its manifest's
   *  text and the other files' paths and sizes; undefined when it is no zip of stored entries with a
   *  manifest and allowed paths only, each once. */
  read(
    id: string,
    file?: string,
  ): { manifest: string; entries: Array<{ path: string; size: number }> } | undefined;
  /** Its files unpacked into the transfer, streamed and hashed on the way; false at the first that is
   *  not as `listed` (by path: its size and hash). */
  unpack(
    id: string,
    listed: ReadonlyMap<string, Omit<ProfileFileEntry, "path">>,
    file?: string,
  ): Promise<boolean>;
  /** The unpacked database made ready, apart from the server's work: its schema exactly what this
   *  app's migrations make (before anything of it is read), sound (integrity, references), its
   *  migrations those, migrated forward (the usual copy before), its secrets emptied. "newer" when it
   *  has a migration this app does not know; "damaged" also when it takes too long. Only the
   *  endpoints of the providers in `endpoints` are kept (the others' would not count). */
  settle(id: string, endpoints: readonly string[]): Promise<"ok" | "newer" | "damaged">;
  /** At the start: a profile's folder an import moved into place but whose row was never made (the
   *  process stopped in between: a mark left in it) goes; one `known` keeps it, without the mark. */
  unfinished(known: (profileId: string) => boolean): void;
  /** The unpacked profile moved into place as `profiles/<profileId>` and `register`ed; moved back
   *  into the transfer when that fails. Marked until registered (`unfinished`). */
  adopt<T>(id: string, profileId: string, register: () => T): T;
  discard(id: string): void;
}

/** What a profile's runs and cards name: the courses and exams by key with their editions, the
 *  imported decks by id (titles are added from what is installed). */
export function contentUsed(store: Pick<RunStore, "all">, cards: Pick<CardStore, "all">) {
  const courses = new Map<string, Set<string>>();
  const exams = new Map<string, Set<string>>();
  const add = (to: Map<string, Set<string>>, key: string, edition: string | null) => {
    const editions = to.get(key) ?? new Set<string>();
    if (edition) editions.add(edition);
    to.set(key, editions);
  };
  for (const kind of ["lesson", "chat", "scene"] as const)
    for (const run of store.all(kind)) if (run.courseKey) add(courses, run.courseKey, run.edition);
  for (const run of store.all("exam")) if (run.contextKey) add(exams, run.contextKey, run.edition);
  const decks = new Set<string>();
  for (const note of cards.all()) {
    const [kind, key] = [
      note.deck.slice(0, note.deck.indexOf(":")),
      note.deck.slice(note.deck.indexOf(":") + 1),
    ];
    if (kind === "deck") decks.add(key);
    else add(courses, key, null);
  }
  const listed = (from: Map<string, Set<string>>) =>
    [...from].map(([key, editions]) => ({ key, editions: [...editions].sort() }));
  return { courses: listed(courses), exams: listed(exams), decks: [...decks] };
}
export type ContentKeys = ReturnType<typeof contentUsed>;

/** An export prepared and not yet downloaded goes after an hour, its transfer with it. */
export const PREPARED_MS = 60 * 60_000;

/** A zip's bytes as fflate writes it: each entry's local header, data and descriptor, the directory. */
const zipBytes = (names: string[], sizes: number) =>
  names.reduce((n, name) => n + 30 + 16 + 46 + 2 * name.length, 0) + sizes + 22;

/** A full disk, found before writing or while writing. */
const noSpace = (error: unknown) => (error as { code?: string } | null)?.code === "ENOSPC";

export function createProfileTransfer(deps: {
  files: TransferFiles;
  profiles: Profiles;
  /** What a profile's runs and cards name. */
  used(profileId: string): ContentKeys;
  content: Content;
  /** The imported decks here, with their titles. */
  decks(): Array<{ id: string; title: string }>;
  appVersion: string;
  now: () => number;
}) {
  const { files, profiles, content, now } = deps;
  const prepared = new Map<
    string,
    {
      profileId: string;
      manifest: string;
      paths: string[];
      fileName: string;
      bytes: number;
      /** Lets it go after PREPARED_MS. */
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /** Forgets a prepared export: downloaded (its stream has the transfer now), or let go with it. */
  const forget = (id: string, discard: boolean) => {
    const p = prepared.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    prepared.delete(id);
    if (discard) files.discard(id);
  };
  // At the start: a stopped server's transfers, and its imports cut short between moving a profile's
  // folder into place and making its row.
  files.sweep();
  files.unfinished((id) => profiles.list().some((p) => p.id === id));

  /** A full disk as the learner's error; anything else as it is. */
  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (noSpace(error)) throw new ServiceError("not_enough_space", 507);
      throw error;
    }
  }

  /** The content used with the titles it has here (null: not installed here). */
  async function titled(keys: ContentKeys): Promise<ContentUsed> {
    const courses = await content.courses();
    const titleOf = (key: string, editions: string[]) => {
      const course = courses.find((c) => c.key === key || (c.exams as string[]).includes(key));
      return course ? courseTitle(course, editions) : null;
    };
    const decks = new Map(deps.decks().map((d) => [d.id, d.title]));
    return {
      courses: keys.courses.map((c) => ({ ...c, title: titleOf(c.key, c.editions) })),
      exams: keys.exams.map((e) => ({ ...e, title: titleOf(e.key, e.editions) })),
      decks: keys.decks.map((id) => ({ id, title: decks.get(id) ?? null })),
    };
  }

  /** What the file's profile used that is not here: courses and exams not installed, or the editions
   *  of them that are not; imported decks not here. */
  async function missing(used: ContentUsed): Promise<ContentUsed> {
    const courses = await content.courses();
    const editionsOf = (key: string, exam: boolean) => {
      const course = courses.find((c) =>
        exam ? (c.exams as string[]).includes(key) : c.key === key,
      );
      return course?.editions;
    };
    const lacking = (exam: boolean) => (u: ContentUsed["courses"][number]) => {
      const here = editionsOf(u.key, exam);
      const editions = here ? u.editions.filter((e) => !here.includes(e)) : u.editions;
      return !here || editions.length ? [{ ...u, editions }] : [];
    };
    const decks = new Set(deps.decks().map((d) => d.id));
    return {
      courses: used.courses.flatMap(lacking(false)),
      exams: used.exams.flatMap(lacking(true)),
      decks: used.decks.filter((d) => !decks.has(d.id)),
    };
  }

  /** The received or given file checked, unpacked and made a new profile; the transfer is the
   *  caller's to discard. */
  async function settle(id: string, file?: string) {
    const read = files.read(id, file);
    if (!read) throw new ServiceError("not_a_profile_file", 422);
    let json: unknown;
    try {
      json = JSON.parse(read.manifest);
    } catch {
      throw new ServiceError("not_a_profile_file", 422);
    }
    const format = (json as { format?: unknown } | null)?.format;
    const version = (json as { version?: unknown } | null)?.version;
    if (format !== PROFILE_FILE_FORMAT) throw new ServiceError("not_a_profile_file", 422);
    if (typeof version === "number" && version > PROFILE_FILE_VERSION)
      throw new ServiceError("profile_from_newer_app", 422);
    const parsed = ProfileManifest.safeParse(json);
    if (!parsed.success) throw new ServiceError("not_a_profile_file", 422);
    const manifest = parsed.data;
    if (manifest.migrations.some((tag) => !files.migrations.includes(tag)))
      throw new ServiceError("profile_from_newer_app", 422);
    // Exactly the files listed, each with its size: then each unpacked and hashed.
    const listed = new Map(manifest.files.map((f) => [f.path, f]));
    const sameFiles =
      listed.size === manifest.files.length &&
      listed.size === read.entries.length &&
      listed.has("profile.sqlite") &&
      read.entries.every((e) => listed.get(e.path)?.size === e.size);
    if (!sameFiles || !(await files.unpack(id, listed, file)))
      throw new ServiceError("profile_file_damaged", 422);
    const settled = await files.settle(id, EDITABLE_ENDPOINTS);
    if (settled === "newer") throw new ServiceError("profile_from_newer_app", 422);
    if (settled === "damaged") throw new ServiceError("profile_file_damaged", 422);
    const profileId = ulid(now()).toLowerCase();
    const profile = files.adopt(id, profileId, () =>
      profiles.adopt({ id: profileId, ...manifest.profile }),
    );
    return {
      profile,
      leftOut: manifest.leftOut,
      missing: await missing(manifest.content),
    };
  }

  /** A profile's export not yet downloaded let go (a new one replaces it: one a profile at most). */
  const letGo = (profileId: string) => {
    for (const [id, p] of prepared) if (p.profileId === profileId) forget(id, true);
  };
  /** A prepare asked for again while it runs gets the same one: one snapshot a profile at a time. */
  const preparing = createOnce<Awaited<ReturnType<typeof make>>>();
  /** Whether an import runs (one at a time: each needs the room of its file twice and more). */
  let importing = false;
  /** An import, the only one while it runs (409 `profile_import_busy` beside it). */
  async function alone<T>(work: () => Promise<T>) {
    if (importing) throw new ServiceError("profile_import_busy", 409);
    importing = true;
    try {
      return await work();
    } finally {
      importing = false;
    }
  }

  async function make(profileId: string) {
    const profile = profiles.get(profileId);
    if (!profile.name) throw new ServiceError("name_required");
    letGo(profileId);
    files.sweep();
    const snap = await guarded(() => files.snapshot(profileId));
    try {
      const paths = snap.files.map((f) => f.path);
      const manifest = JSON.stringify({
        format: PROFILE_FILE_FORMAT,
        version: PROFILE_FILE_VERSION,
        appVersion: deps.appVersion,
        exportedAt: now(),
        profile: { name: profile.name, colour: profile.colour },
        migrations: snap.migrations,
        content: await titled(deps.used(profileId)),
        leftOut: { apiKeys: snap.apiKeys, endpointLogins: snap.endpointLogins },
        files: snap.files,
      } satisfies ProfileManifest);
      const bytes = zipBytes(
        ["manifest.json", ...paths],
        new TextEncoder().encode(manifest).length + snap.files.reduce((n, f) => n + f.size, 0),
      );
      if (bytes > PROFILE_FILE_MAX_BYTES) throw new ServiceError("profile_file_too_large", 422);
      const day = new Date(now()).toISOString().slice(0, 10);
      // A name a file system takes: no separators or characters reserved on Windows.
      const base = profile.name.replace(/[\\/:*?"<>|\p{Cc}]+/gu, "-").replace(/^[.\s]+/, "");
      const fileName = `${base || "profile"}-${day}${PROFILE_FILE_EXTENSION}`;
      const timer = setTimeout(() => forget(snap.id, true), PREPARED_MS);
      // Never what keeps the process (the command line) running.
      (timer as { unref?: () => void }).unref?.();
      prepared.set(snap.id, { profileId, manifest, paths, fileName, bytes, timer });
      return {
        id: snap.id,
        fileName,
        bytes,
        leftOut: { apiKeys: snap.apiKeys, endpointLogins: snap.endpointLogins },
      };
    } catch (error) {
      files.discard(snap.id);
      throw error;
    }
  }

  const self = {
    /** A profile's file made ready to download: its name, size and what it leaves out. The one made
     *  before and not downloaded goes. */
    prepare: (profileId: string) => preparing(profileId, () => make(profileId)),

    /** A prepared export still there to download: its file's name and size (404 when it is not this
     *  profile's, gone or downloaded). Nothing taken: asked before a download starts. */
    ready(profileId: string, id: string) {
      const p = prepared.get(id);
      if (!p || p.profileId !== profileId) throw new ServiceError("profile_export_gone", 404);
      return { fileName: p.fileName, bytes: p.bytes };
    },

    /** A prepared export as a stream, once (404 as `ready`). */
    download(profileId: string, id: string) {
      self.ready(profileId, id);
      const p = prepared.get(id) as NonNullable<ReturnType<typeof prepared.get>>;
      forget(id, false);
      return {
        stream: files.stream(id, p.manifest, p.paths),
        fileName: p.fileName,
        bytes: p.bytes,
      };
    },

    /** A profile exported to a file (the command line): where, given the file's own name. */
    async exportTo(profileId: string, where: (fileName: string) => string) {
      const ready = await self.prepare(profileId);
      const { stream, bytes } = self.download(profileId, ready.id);
      try {
        const file = where(ready.fileName);
        await guarded(() => files.save(stream, file, bytes));
        return { ...ready, file };
      } catch (error) {
        // The transfer goes with its stream.
        await stream.cancel().catch(() => undefined);
        throw error;
      }
    },

    /** A profile file uploaded (from "Who is studying?": registration open, or no profile yet) and
     *  imported as a new profile. */
    async importUpload(body: AsyncIterable<Uint8Array> | null, length: number | undefined) {
      // Before a byte of it is read: whether a profile may be made here, and its length told.
      if (profiles.list().length && !profiles.registrationOpen())
        throw new ServiceError("registration_closed", 403);
      if (length === undefined) throw new ServiceError("length_required", 411);
      if (length > PROFILE_FILE_MAX_BYTES) throw new ServiceError("profile_file_too_large", 413);
      if (!body) throw new ServiceError("not_a_profile_file", 422);
      return alone(async () => {
        files.sweep();
        const id = files.begin();
        try {
          return await guarded(async () => {
            if (!(await files.receive(id, body, length)))
              throw new ServiceError("profile_file_too_large", 413);
            return await settle(id);
          });
        } finally {
          files.discard(id);
        }
      });
    },

    /** A profile file on disk imported as a new profile (the command line). */
    importFile: (file: string) =>
      alone(async () => {
        const id = files.begin();
        try {
          return await guarded(() => settle(id, file));
        } finally {
          files.discard(id);
        }
      }),
  };
  return self;
}
export type ProfileTransfer = ReturnType<typeof createProfileTransfer>;
