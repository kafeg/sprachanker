// Decks moved between one's own machines, each on its own as a deck file (owner, 2026-10-15): a
// course's words' extras, an imported deck, a profile's Finds — each with what was made for its words
// (audio read aloud, the AI's examples). Exported: the deck's folder as it is, its files linked and
// streamed as a zip with a manifest. Imported: received, every file checked against the manifest and
// by its schema, previewed; then merged into the deck there — words and extras by lexeme, what is here
// kept, what is missing added — the folder replaced whole. A Finds deck becomes the importing
// profile's own, its words its cards. The files themselves are the runtime's (DeckTransferFiles).
import {
  DECK_BUNDLE_EXTENSION,
  DECK_BUNDLE_FORMAT,
  DECK_BUNDLE_MAX_BYTES,
  DECK_BUNDLE_VERSION,
  Deck,
  type DeckBundleDeck,
  DeckBundleManifest,
  type DeckExtrasWord,
  type DeckId,
  findsDeckId,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { BundleFileEntry } from "./course-transfer.ts";
import { type DeckExtrasStore, extrasMedia, readExtras } from "./deck-extras.ts";
import type { Decks } from "./decks.ts";
import { parseJson } from "./stored.ts";
import { guarded, preparedExports } from "./transfers.ts";

/** A zip's entry made in memory. */
export type ZipHead = { name: string; bytes: Uint8Array };

/**
 * Deck files on disk (runtime adapter): each export or import works in a transfer folder of its own
 * (`decks/.transfers/<id>/`), removed when it ends. A full disk is an error with code `ENOSPC`.
 */
export interface DeckTransferFiles {
  /** Transfers an hour old go. */
  sweep(): void;
  /** A deck folder's files (`paths` of it: those there) linked into a new transfer, each hashed. */
  stage(folder: string, paths: string[]): Promise<{ id: string; files: BundleFileEntry[] }>;
  /** Files of the data root — a deck folder's media (`decks`, `<folder>/media/<name>`), a course's
   *  recording (`library`, `<series>/<path>`) — linked into a new transfer as the zip's numbered
   *  entries (`0`, `1`, … as an .apkg names its media), each summed: `staged`, the sources there, by
   *  their place in `sources` (the n-th staged is entry `n`). */
  stageNumbered(
    sources: Array<{ root: "decks" | "library"; path: string }>,
  ): Promise<{ id: string; staged: number[] }>;
  /** The length of the file `stream` makes. */
  bytes(id: string, head: ZipHead[], paths: string[]): number;
  /** A staged deck as a zip: `head` first (a deck file's manifest, an .apkg's collection), then its
   *  files in the order given; the transfer goes when the stream ends or is cancelled. */
  stream(id: string, head: ZipHead[], paths: string[]): ReadableStream<Uint8Array>;
  /** A new, empty transfer. */
  begin(): string;
  /** A file of `length` bytes received into the transfer, the room for it checked first; false when
   *  more comes. */
  receive(id: string, body: AsyncIterable<Uint8Array>, length: number): Promise<boolean>;
  /** The received file read by its zip directory: its manifest's text and the other files' paths
   *  and sizes; undefined when it is no zip of stored entries with a manifest and paths a deck file
   *  may hold, each once. */
  read(
    id: string,
  ): { manifest: string; entries: Array<{ path: string; size: number }> } | undefined;
  /** Its files unpacked into the transfer, streamed and hashed: "damaged" at the first one not as
   *  listed. */
  unpack(id: string, manifest: DeckBundleManifest): Promise<"ok" | "damaged">;
  /** A staged or unpacked file's text (deck.json, extras.json); undefined when there is none. */
  text(id: string, path: string): string | undefined;
  /** The unpacked deck placed into a deck folder, whole or not at all: deck.json and extras.json as
   *  given (none: as they are there), the media named that the file holds and the folder lacks. */
  place(
    id: string,
    folder: string,
    written: { deck?: string; extras?: string },
    media: string[],
  ): Promise<void>;
  discard(id: string): void;
}

/** A deck file read: its manifest, its deck (none: a course's), the extras of its words, the
 *  files it holds. */
type Unpacked = {
  manifest: DeckBundleManifest;
  deck: Deck | undefined;
  extras: Record<string, DeckExtrasWord>;
  held: Set<string>;
};

/** A deck's words, with audio, with examples — its own or made, audio counted only where its file is
 *  `held`: an imported deck's or Finds' words; a course's, those something was made for. */
function counts(deck: Deck | undefined, extras: Record<string, DeckExtrasWord>, held: Set<string>) {
  const read = (e: DeckExtrasWord | undefined) => !!e && extrasMedia(e).some((p) => held.has(p));
  const made = (e: DeckExtrasWord | undefined) => !!e?.examples;
  if (!deck) {
    const all = Object.values(extras);
    return {
      words: all.length,
      withAudio: all.filter(read).length,
      withExamples: all.filter(made).length,
    };
  }
  return {
    words: deck.words.length,
    withAudio: deck.words.filter((w) => (w.audio && held.has(w.audio)) || read(extras[w.lexeme]))
      .length,
    withExamples: deck.words.filter((w) => w.examples?.length || made(extras[w.lexeme])).length,
  };
}

/** The media a deck's words and extras name. */
const mediaOf = (deck: Deck | undefined, extras: Record<string, DeckExtrasWord>) => [
  ...new Set([
    ...(deck?.words ?? []).flatMap((w) =>
      [w.audio, ...(w.examples ?? []).map((e) => e.audio)].flatMap((p) => p ?? []),
    ),
    ...Object.values(extras).flatMap(extrasMedia),
  ]),
];

const DAMAGED = () => new ServiceError("deck_file_damaged", 422);

/** A deck folder's deck.json and extras.json as a deck file holds them (staged or unpacked), read:
 *  a course's has no deck.json, a deck's its own (its id the folder's; a Finds deck's with an owner,
 *  an imported one's without). */
function readFolder(
  text: (path: string) => string | undefined,
  deck: DeckBundleDeck,
): Omit<Unpacked, "manifest" | "held"> {
  const json = text("deck.json");
  let read: Deck | undefined;
  if (deck.kind === "course") {
    if (json !== undefined) throw DAMAGED();
  } else {
    const parsed = Deck.safeParse(parseJson(json ?? ""));
    const owned = parsed.success && parsed.data.owner !== undefined;
    if (!parsed.success || parsed.data.id !== deck.folder || owned !== (deck.kind === "finds"))
      throw DAMAGED();
    read = parsed.data;
  }
  const extras = text("extras.json");
  if (extras !== undefined && !(parseJson(extras) as { words?: unknown } | undefined)?.words)
    throw DAMAGED();
  return { deck: read, extras: readExtras(extras, "a deck file's extras").book.words };
}

/** Bytes a body begins with that tell a deck file: a zip whose first entry is `manifest.json`
 *  (zip.ts writes it first; an .apkg never begins so). */
const NAME = "manifest.json";
const HEAD = 30 + NAME.length;

/**
 * Whether an uploaded body of `length` bytes is a deck file of the app's own — told by its content,
 * not its name —, and the body to read, whole: the bytes looked at first, then the rest. One whose
 * length is not told is not read (refused as it is).
 */
export async function sniffDeckFile(
  body: ReadableStream<Uint8Array> | null,
  length: number | undefined,
) {
  if (!body || length === undefined) return { deckFile: false, body };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let ended = false;
  while (size < HEAD) {
    const next = await reader.read();
    if (next.done) {
      ended = true;
      break;
    }
    chunks.push(next.value);
    size += next.value.length;
  }
  const head = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    head.set(c, at);
    at += c.length;
  }
  const deckFile =
    size >= HEAD &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    head[2] === 3 &&
    head[3] === 4 &&
    ((head[26] ?? 0) | ((head[27] ?? 0) << 8)) === NAME.length &&
    new TextDecoder().decode(head.subarray(30, HEAD)) === NAME;
  const rest = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      if (ended) controller.close();
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { deckFile, body: rest };
}

export function createDeckTransfer(deps: {
  files: DeckTransferFiles;
  decks: Decks;
  extras: DeckExtrasStore;
  /** An installed course as a deck file names it: its words' language, its editions' learners'
   *  languages, its title; undefined when it is not installed. */
  course(
    key: string,
  ): Promise<{ lang: string; translationLangs: string[]; title: string } | undefined>;
  /** After a course's extras were imported: cards follow (relinking). */
  onImported(): void;
  appVersion: string;
  now: () => number;
}) {
  const { files } = deps;
  /** Files received and previewed, each the profile's that sent it, until imported (an hour). */
  const waiting = preparedExports<Unpacked & { fileName: string; bytes: number }>(
    files.discard,
    "deck_upload_gone",
  );
  /** Exports made ready, each the profile's that asked, until downloaded (an hour). */
  const exports = preparedExports<{
    head: ZipHead[];
    paths: string[];
    fileName: string;
    bytes: number;
  }>(files.discard, "deck_export_gone");
  files.sweep();
  /** Imports, one after another (each merges into what the one before wrote). */
  let importing: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>) => {
    const done = importing.then(work);
    importing = done.catch(() => {});
    return done;
  };
  /** A deck folder whose jobs work now is not written over (they would save into what goes). */
  const notBusy = (folder: string) => {
    if (deps.extras.busy(folder)) throw new ServiceError("deck_job_running", 409);
  };

  /** The received file's manifest: refused when it is no deck file, a newer one, or one whose files
   *  are not those listed. */
  function manifestOf(id: string) {
    const read = files.read(id);
    if (!read) throw DAMAGED();
    const json = parseJson(read.manifest) as { format?: unknown; version?: unknown } | undefined;
    if (json?.format !== DECK_BUNDLE_FORMAT) throw DAMAGED();
    if (typeof json.version === "number" && json.version > DECK_BUNDLE_VERSION)
      throw new ServiceError("deck_file_from_newer_app", 422);
    const parsed = DeckBundleManifest.safeParse(json);
    if (!parsed.success) throw DAMAGED();
    const manifest = parsed.data;
    const listed = new Map(manifest.files.map((f) => [f.path, f.size]));
    const same =
      listed.size === manifest.files.length &&
      listed.size === read.entries.length &&
      read.entries.every((e) => listed.get(e.path) === e.size);
    if (!same) throw DAMAGED();
    return manifest;
  }

  /** What a profile does with deck files: its decks exported (only those it sees), files previewed
   *  and imported (a Finds deck as its own: `take` makes the words added its cards, after those of
   *  its cards that name the deck as it was, `from`, follow it — each word's key there to its key
   *  here, `keys`). */
  function of(
    profile: string,
    take: (
      deck: DeckId,
      from: DeckId,
      keys: Map<string, string>,
      added: string[],
    ) => Promise<unknown>,
  ) {
    const decks = deps.decks.of(profile);

    /** Where a file's deck goes here: a Finds deck's into the profile's own of its pair; an imported
     *  deck's into the deck here it is (by its notes, else its id: `sameAs`), else a new one of its
     *  id (numbered when that is taken); a course's into its course's folder. */
    const targetOf = ({ manifest, deck }: Unpacked) => {
      if (!deck) return manifest.deck.folder;
      if (manifest.deck.kind === "finds")
        return findsDeckId(profile, deck.lang, deck.translationLang);
      return deps.decks.sameAs(deck)?.id ?? deps.decks.freeId(deck.id);
    };

    /** What a preview says: the file's deck, its words, with audio, with examples, whether it joins
     *  a deck here (its words and extras merged), whether its course is not here (it waits for it). */
    async function describe(upload: string, file: Unpacked) {
      const { kind, course, title, lang, translationLangs } = file.manifest.deck;
      const target = targetOf(file);
      const here = file.deck ? decks.deck(target) : undefined;
      const installed = course ? !!(await deps.course(course)) : true;
      return {
        upload,
        kind,
        title,
        lang,
        translationLangs,
        course: course ?? null,
        ...counts(file.deck, file.extras, file.held),
        merges: file.deck ? !!here : Object.keys(deps.extras.book(target).words).length > 0,
        waits: !installed,
      };
    }

    const self = {
      /** A deck the profile sees made ready as a file — an imported deck or its Finds
       *  (`deck:<id>`), a course's (`course:<key>`, installed, something made for its words) —: its
       *  files linked aside, counted as they are there. Its id, name and size; one not downloaded
       *  within an hour goes. */
      async prepare(scope: string) {
        const id = scope.startsWith("deck:") ? scope.slice("deck:".length) : undefined;
        const deck = id === undefined ? undefined : decks.deck(id);
        if (id !== undefined && !deck) throw new ServiceError("no_such_deck", 404);
        const folder = deck?.id ?? (await deps.extras.folderOf(scope));
        const course = deck ? undefined : scope.slice("course:".length);
        const about = course ? await deps.course(course) : undefined;
        if (course && !about) throw new ServiceError("no_such_deck", 404);
        const book = deps.extras.book(folder).words;
        const paths = [
          ...(deck ? ["deck.json"] : []),
          "extras.json",
          ...mediaOf(deck, book).sort(),
        ];
        const staged = await guarded(() => files.stage(folder, paths));
        try {
          const kind = deck ? (deck.owner ? "finds" : "imported") : "course";
          const named = {
            kind,
            folder,
            ...(course && { course: course as DeckBundleDeck["course"] }),
          } as DeckBundleDeck;
          // As the file holds them: the folder's files when they were linked.
          const held = new Set(staged.files.map((f) => f.path));
          const there = readFolder((path) => files.text(staged.id, path), named);
          if (!there.deck && !Object.keys(there.extras).length)
            throw new ServiceError("no_such_deck", 404);
          const info: DeckBundleDeck = {
            ...named,
            title: there.deck?.title ?? about?.title ?? folder,
            lang: (there.deck?.lang ?? about?.lang) as DeckBundleDeck["lang"],
            translationLangs: (there.deck
              ? [there.deck.translationLang]
              : (about?.translationLangs ?? [])) as DeckBundleDeck["translationLangs"],
            ...counts(there.deck, there.extras, held),
          };
          const manifest = JSON.stringify({
            format: DECK_BUNDLE_FORMAT,
            version: DECK_BUNDLE_VERSION,
            appVersion: deps.appVersion,
            exportedAt: deps.now(),
            deck: info,
            files: staged.files,
          } satisfies DeckBundleManifest);
          const kept = staged.files.map((f) => f.path);
          const head = [{ name: "manifest.json", bytes: new TextEncoder().encode(manifest) }];
          const bytes = files.bytes(staged.id, head, kept);
          if (bytes > DECK_BUNDLE_MAX_BYTES) throw new ServiceError("deck_file_too_large", 422);
          const day = new Date(deps.now()).toISOString().slice(0, 10);
          const name =
            kind === "finds" && there.deck
              ? `finds-${there.deck.translationLang}-${there.deck.lang}`
              : folder.replace(/^course~/, "").replaceAll("~", "-");
          const fileName = `${name}-${day}${DECK_BUNDLE_EXTENSION}`;
          exports.keep(staged.id, profile, { head, paths: kept, fileName, bytes });
          return { id: staged.id, fileName, bytes };
        } catch (error) {
          files.discard(staged.id);
          throw error;
        }
      },

      /** An export made ready still there to download: its name and size (404 when it is gone or
       *  downloaded). Nothing taken: asked before a download starts. */
      ready(id: string) {
        const { fileName, bytes } = exports.ready(profile, id);
        return { fileName, bytes };
      },

      /** An export made ready as a stream, once (404 as `ready`). */
      download(id: string) {
        const p = exports.take(profile, id);
        return {
          stream: files.stream(id, p.head, p.paths),
          fileName: p.fileName,
          bytes: p.bytes,
        };
      },

      /** A deck file uploaded (`length` bytes, as announced), checked whole and unpacked: what it
       *  holds and where it goes (its upload's id imports it). */
      async preview(body: AsyncIterable<Uint8Array> | null, length: number | undefined) {
        if (length === undefined) throw new ServiceError("length_required", 411);
        if (length > DECK_BUNDLE_MAX_BYTES) throw new ServiceError("deck_file_too_large", 413);
        if (!body) throw DAMAGED();
        const id = files.begin();
        try {
          return await guarded(async () => {
            if (!(await files.receive(id, body, length)))
              throw new ServiceError("deck_file_too_large", 413);
            const manifest = manifestOf(id);
            if ((await files.unpack(id, manifest)) !== "ok") throw DAMAGED();
            const file: Unpacked = {
              manifest,
              ...readFolder((path) => files.text(id, path), manifest.deck),
              held: new Set(manifest.files.map((f) => f.path)),
            };
            const preview = await describe(id, file);
            // Kept as an export waiting is (its name and size unused).
            waiting.keep(id, profile, { ...file, fileName: "", bytes: length });
            return preview;
          }, "deck_file_damaged");
        } catch (error) {
          files.discard(id);
          throw error;
        }
      },

      /**
       * A deck file previewed imported (`targetOf`): merged into what is there by lexeme — the words
       * and the extras here stay, what they lack the file gives, and media the folder has not. A
       * Finds deck's words added become the profile's cards; a course's extras for a course not here
       * wait for it. Refused while a job works on the deck. Kept until it is imported (a failed
       * import can be tried again). Its deck's kind and title and the words it added.
       */
      import(upload: string) {
        return inTurn(() =>
          guarded(async () => {
            const file = waiting.ready(profile, upload);
            const { kind, title, course, folder } = file.manifest.deck;
            const target = targetOf(file);
            notBusy(target);
            let words: number;
            if (file.deck) {
              const incoming = Deck.parse({
                ...file.deck,
                id: target,
                owner: kind === "finds" ? profile : undefined,
              });
              const merged = await deps.decks.merge(incoming, async (text, deck) => {
                const extras = deps.extras.merged(target, file.extras);
                await files.place(upload, target, { deck: text, extras: extras.text }, [
                  ...mediaOf(deck, {}),
                  ...extras.media,
                ]);
              });
              words = merged.added.length;
              if (kind === "finds") {
                // Each word's key in the file to its key here (a word here already keeps its own).
                const here = new Map(merged.deck.words.map((w) => [w.lexeme, w.key]));
                const keys = new Map(
                  file.deck.words.flatMap((w) => {
                    const key = here.get(w.lexeme);
                    return key ? [[w.key, key] as const] : [];
                  }),
                );
                await take(
                  target as DeckId,
                  folder as DeckId,
                  keys,
                  merged.added.map((w) => w.key),
                );
              }
            } else {
              deps.extras.forget(target);
              try {
                const extras = deps.extras.merged(target, file.extras);
                words = extras.added;
                await files.place(upload, target, { extras: extras.text }, extras.media);
              } finally {
                deps.extras.forget(target);
              }
              deps.onImported();
            }
            // Imported: the file goes.
            waiting.take(profile, upload);
            files.discard(upload);
            return { kind, title, course: course ?? null, words };
          }),
        );
      },

      /** A file previewed let go unimported (its sheet closed). */
      discard(upload: string) {
        if (waiting.waiting(profile, upload)) waiting.drop(upload);
      },
    };
    return self;
  }
  return { of };
}
export type DeckTransfer = ReturnType<typeof createDeckTransfer>;
export type ProfileDeckTransfer = ReturnType<DeckTransfer["of"]>;
